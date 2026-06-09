// server-standalone.js - 订单支付模块独立服务器
const crypto = require("crypto");
const path = require("path");
const express = require("express");

// 导入原有模块（复用数据读写）
const {
  addOrder,
  findShow,
  getCinemas,
  getMovies,
  getOrders,
  markSeatsSold,
  updateOrder,
} = require("./src/catalog");
const { issueSession, permissionsForRole, requireAuth, verifyLogin } = require("./src/auth");

const app = express();
const PORT = process.env.PORT || 3000;

// 内存锁（替代 Redis）
const seatLocks = new Map();

function lockSeat(showId, seat, ownerId, ttlSeconds) {
  const key = `${showId}:${seat}`;
  const now = Date.now();
  const existing = seatLocks.get(key);
  if (existing && existing.expiresAt > now && existing.owner !== ownerId) {
    return false;
  }
  seatLocks.set(key, { owner: ownerId, expiresAt: now + ttlSeconds * 1000 });
  return true;
}

function releaseSeat(showId, seat, ownerId) {
  const key = `${showId}:${seat}`;
  const lock = seatLocks.get(key);
  if (lock && lock.owner === ownerId) {
    seatLocks.delete(key);
    return true;
  }
  return false;
}

function getLockOwner(showId, seat) {
  const key = `${showId}:${seat}`;
  const lock = seatLocks.get(key);
  if (lock && lock.expiresAt > Date.now()) {
    return lock.owner;
  }
  if (lock) seatLocks.delete(key);
  return null;
}

// 中间件
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// 静态资源映射
app.use("/vendor/vue.global.prod.js", express.static(
  path.join(__dirname, "node_modules", "vue", "dist", "vue.global.prod.js")
));
app.use("/vendor/echarts.min.js", express.static(
  path.join(__dirname, "node_modules", "echarts", "dist", "echarts.min.js")
));

// ========== 登录认证接口 ==========
app.post("/api/auth/login", (req, res) => {
  const { portal = "customer", login, password } = req.body || {};
  const role = portal === "admin" ? "ADMIN" : "CUSTOMER";
  const user = verifyLogin(String(login || ""), String(password || ""), role);
  if (!user) {
    res.status(401).json({ error: "INVALID_CREDENTIALS", message: "账号或密码错误" });
    return;
  }
  res.json({
    token: issueSession(user),
    user,
    permissions: permissionsForRole(user.role),
    tokenType: "Bearer",
    portal: role === "ADMIN" ? "admin" : "customer",
    redirect: role === "ADMIN" ? "#admin" : "#booking",
  });
});

app.get("/api/me", requireAuth(), (req, res) => {
  res.json({ user: req.user, permissions: req.auth.permissions });
});

// ========== 健康检查 ==========
app.get("/api/health", (_req, res) => {
  res.json({ status: "UP", mode: "standalone", timestamp: new Date().toISOString() });
});

// ========== 影片和影院接口 ==========
app.get("/api/movies", (_req, res) => {
  res.json({ movies: getMovies() });
});

app.get("/api/cinemas", (_req, res) => {
  res.json({ cinemas: getCinemas() });
});

// ========== 场次座位接口 ==========
app.get("/api/shows/:showId/seats", async (req, res) => {
  const item = findShow(req.params.showId);
  if (!item) {
    res.status(404).json({ error: "SHOW_NOT_FOUND" });
    return;
  }
  const seats = [];
  for (const seat of item.show.seats) {
    const owner = getLockOwner(item.show.id, seat);
    const status = item.show.sold.includes(seat) ? "sold" : owner ? "locked" : "available";
    seats.push({ id: seat, status });
  }
  res.json({ seats, show: item.show });
});

// ========== 创建订单 ==========
app.post("/api/orders", requireAuth(), async (req, res) => {
  const { showId, seats } = req.body || {};
  const MAX_SEATS = 4;
  
  if (!showId || !Array.isArray(seats) || seats.length === 0) {
    res.status(400).json({ error: "INVALID_ORDER_REQUEST" });
    return;
  }
  
  const item = findShow(showId);
  if (!item) {
    res.status(404).json({ error: "SHOW_NOT_FOUND" });
    return;
  }
  
  const uniqueSeats = [...new Set(seats.map(s => String(s).trim()).filter(Boolean))];
  if (uniqueSeats.length > MAX_SEATS) {
    res.status(400).json({ error: "INVALID_SEAT_COUNT", maxSeats: MAX_SEATS });
    return;
  }
  
  for (const seat of uniqueSeats) {
    if (!item.show.seats.includes(seat)) {
      res.status(400).json({ error: "INVALID_SEAT", seat });
      return;
    }
    if (item.show.sold.includes(seat)) {
      res.status(409).json({ error: "SEAT_ALREADY_SOLD", seat });
      return;
    }
  }
  
  const orderId = crypto.randomUUID();
  const lockedSeats = [];
  for (const seat of uniqueSeats) {
    const locked = lockSeat(showId, seat, orderId, 120);
    if (!locked) {
      for (const s of lockedSeats) releaseSeat(showId, s, orderId);
      res.status(409).json({ error: "SEAT_TEMPORARILY_LOCKED", seat });
      return;
    }
    lockedSeats.push(seat);
  }
  
  const order = {
    id: orderId,
    showId,
    movieTitle: item.movie.title,
    cinema: item.show.cinema,
    hall: item.show.hall,
    startsAt: item.show.startsAt,
    seats: uniqueSeats,
    userId: req.user.id,
    userName: req.user.displayName,
    amount: uniqueSeats.length * item.show.price,
    status: "PENDING_PAYMENT",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 120000).toISOString(),
  };
  addOrder(order);
  
  console.log(`[订单创建] ${orderId} - ${req.user.displayName}`);
  res.status(201).json({ order, lockTtlSeconds: 120 });
});

// ========== 【D部分】获取我的订单 ==========
app.get("/api/my/orders", requireAuth(), (req, res) => {
  const orders = getOrders()
    .filter(order => order.userId === req.user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ orders });
});

// ========== 【D部分】支付订单 ==========
app.post("/api/orders/:orderId/pay", requireAuth(), async (req, res) => {
  const order = getOrders().find(o => o.id === req.params.orderId);
  
  if (!order) {
    res.status(404).json({ error: "ORDER_NOT_FOUND" });
    return;
  }
  
  if (order.userId !== req.user.id && req.user.role !== "ADMIN") {
    res.status(403).json({ error: "FORBIDDEN" });
    return;
  }
  
  if (order.status !== "PENDING_PAYMENT") {
    res.status(409).json({ error: "ORDER_NOT_PAYABLE", status: order.status });
    return;
  }
  
  // 🔧 修改这里：超时后自动取消订单
  if (new Date(order.expiresAt) <= new Date()) {
    // 超时：自动取消订单并释放锁
    for (const seat of order.seats) {
      releaseSeat(order.showId, seat, order.id);
    }
    
    const cancelledOrder = updateOrder(order.id, (row) => {
      row.status = "CANCELLED";
      row.cancelReason = "ORDER_EXPIRED";
      row.cancelledAt = new Date().toISOString();
    });
    
    console.log(`[订单超时取消] ${order.id}`);
    res.status(409).json({ 
      error: "ORDER_EXPIRED", 
      message: "订单已超时，已被自动取消",
      order: cancelledOrder 
    });
    return;
  }
  
  // 验证锁
  for (const seat of order.seats) {
    const owner = getLockOwner(order.showId, seat);
    if (owner !== order.id) {
      res.status(409).json({ error: "LOCK_LOST", seat });
      return;
    }
  }
  
  // 释放锁并标记已售
  for (const seat of order.seats) {
    releaseSeat(order.showId, seat, order.id);
  }
  markSeatsSold(order.showId, order.seats);
  
  const paidOrder = updateOrder(order.id, (row) => {
    row.status = "PAID";
    row.paidAt = new Date().toISOString();
  });
  
  console.log(`[订单支付] ${order.id} - 金额: ${order.amount}`);
  res.json({ order: paidOrder });
});

// ========== 【D部分】取消订单 ==========
app.post("/api/orders/:orderId/cancel", requireAuth(), async (req, res) => {
  const order = getOrders().find(o => o.id === req.params.orderId);
  
  if (!order) {
    res.status(404).json({ error: "ORDER_NOT_FOUND" });
    return;
  }
  
  if (order.userId !== req.user.id && req.user.role !== "ADMIN") {
    res.status(403).json({ error: "FORBIDDEN" });
    return;
  }
  
  // 允许取消 PENDING_PAYMENT 状态的订单（包括已超时的）
  if (order.status !== "PENDING_PAYMENT") {
    res.json({ order });
    return;
  }
  
  // 释放锁
  for (const seat of order.seats) {
    releaseSeat(order.showId, seat, order.id);
  }
  
  const cancelledOrder = updateOrder(order.id, (row) => {
    row.status = "CANCELLED";
    row.cancelReason = req.body?.reason || "USER_CANCELLED";
    row.cancelledAt = new Date().toISOString();
  });
  
  console.log(`[订单取消] ${order.id}`);
  res.json({ order: cancelledOrder });
});

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║     🎬 影院订票系统 - 订单支付模块（独立服务器）        ║
╠══════════════════════════════════════════════════════════╣
║  访问地址: http://localhost:${PORT}                      ║
║  订单页面: http://localhost:${PORT}/orders.html          ║
║  登录页面: http://localhost:${PORT}/login.html           ║
╠══════════════════════════════════════════════════════════╣
║  测试账号:                                              ║
║    用户: user / user123                                 ║
║    管理员: admin / admin123                             ║
╚══════════════════════════════════════════════════════════╝
  `);
});

module.exports = app;