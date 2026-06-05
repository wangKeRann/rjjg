const crypto = require("node:crypto");
const path = require("node:path");
const express = require("express");
const promClient = require("prom-client");
const { issueSession, requireAuth, revokeSession, verifyLogin } = require("./auth");
const RedisStore = require("./redisStore");
const SearchService = require("./searchService");
const {
  COLS,
  ROWS,
  addOrder,
  findShow,
  getCinemas,
  getMovies,
  getOrders,
  getShowsForAdmin,
  markSeatsSold,
  updateOrder,
  updateShowPrice,
} = require("./catalog");

const app = express();
const orders = {
  clear() {
    const { resetDatabase } = require("./database");
    resetDatabase();
  },
  values() {
    return getOrders().values();
  },
};
const LOCK_TTL_SECONDS = 120;

const logger = {
  info(messageOrFields, message) {
    writeLog("info", messageOrFields, message);
  },
  warn(messageOrFields, message) {
    writeLog("warn", messageOrFields, message);
  },
  error(messageOrFields, message) {
    writeLog("error", messageOrFields, message);
  },
};

function writeLog(level, messageOrFields, message) {
  const entry =
    typeof messageOrFields === "string"
      ? { level, message: messageOrFields, at: new Date().toISOString() }
      : { level, ...(messageOrFields || {}), message, at: new Date().toISOString() };
  console.log(JSON.stringify(entry));
}

const store = new RedisStore(logger);
const searchService = new SearchService(logger);

promClient.collectDefaultMetrics();
const httpDuration = new promClient.Histogram({
  name: "cinema_http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status"],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2],
});
const ordersCreated = new promClient.Counter({
  name: "cinema_orders_created_total",
  help: "Total number of created ticket orders",
});
const ordersPaid = new promClient.Counter({
  name: "cinema_orders_paid_total",
  help: "Total number of paid ticket orders",
});
const redisModeGauge = new promClient.Gauge({
  name: "cinema_redis_mode",
  help: "1 when Redis is connected, 0 when memory fallback is active",
});
const elasticsearchModeGauge = new promClient.Gauge({
  name: "cinema_elasticsearch_mode",
  help: "1 when Elasticsearch is connected, 0 when memory fallback is active",
});

app.use(express.json());
app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const duration = Number(process.hrtime.bigint() - start) / 1e9;
    httpDuration.labels(req.method, req.route?.path || req.path, String(res.statusCode)).observe(duration);
  });
  next();
});

app.use(express.static(path.join(__dirname, "..", "public")));
app.use("/vendor/vue.global.prod.js", express.static(path.join(__dirname, "..", "node_modules", "vue", "dist", "vue.global.prod.js")));
app.use("/vendor/echarts.min.js", express.static(path.join(__dirname, "..", "node_modules", "echarts", "dist", "echarts.min.js")));

app.get("/api/health", (_req, res) => {
  redisModeGauge.set(store.mode === "redis" ? 1 : 0);
  elasticsearchModeGauge.set(searchService.mode === "elasticsearch" ? 1 : 0);
  res.json({
    status: "UP",
    redis: store.mode,
    elasticsearch: searchService.mode,
    mq: store.mode === "redis" ? "Redis List queue: cinema-booking-events" : "in-memory event queue",
    search: searchService.mode === "elasticsearch" ? "Elasticsearch indices: movies, cinemas" : "in-memory fallback",
    time: new Date().toISOString(),
  });
});

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
    portal: role === "ADMIN" ? "admin" : "customer",
    redirect: role === "ADMIN" ? "#admin" : "#booking",
  });
});

app.post("/api/auth/logout", requireAuth(), (req, res) => {
  revokeSession(req.token);
  res.json({ ok: true });
});

app.get("/api/me", requireAuth(), (req, res) => {
  res.json({ user: req.user });
});

app.get("/api/movies", (_req, res) => {
  res.json({ movies: getMovies() });
});

app.get("/api/cinemas", (_req, res) => {
  res.json({ cinemas: getCinemas() });
});

app.get("/api/search", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const limit = parseInt(req.query.limit) || 50;
    
    let result;
    if (searchService.mode === 'elasticsearch') {
      result = await searchService.search(q, { limit });
    } else {
      // 内存搜索降级
      const movies = getMovies();
      const cinemas = getCinemas();
      result = searchService.searchInMemory(q, { limit }, movies, cinemas);
    }
    
    res.json(result);
  } catch (error) {
    logger.error({ error: error.message, query: req.query.q }, "Search failed");
    res.status(500).json({ error: "SEARCH_FAILED", message: "搜索服务暂时不可用" });
  }
});

app.get("/api/infrastructure/topology", async (_req, res) => {
  res.json({
    gateway: ["Nginx", "负载均衡"],
    services: ["cinema-web", "spring-security-service", "flask-recommender"],
    middleware: ["Redis", "RabbitMQ", "Elasticsearch"],
    governance: ["Nacos", "Sentinel", "ZooKeeper"],
    deployment: ["Docker", "Kubernetes"],
    observability: ["Prometheus", "Slf4j/logback"],
    database: ["local persistent db", "write-db/read-db design"],
  });
});

app.get("/api/shows/:showId/seats", async (req, res, next) => {
  try {
    const item = findShow(req.params.showId);
    if (!item) {
      res.status(404).json({ error: "SHOW_NOT_FOUND" });
      return;
    }

    const seats = [];
    for (const seat of item.show.seats) {
      const owner = await store.getLockOwner(item.show.id, seat);
      const status = item.show.sold.includes(seat) ? "sold" : owner ? "locked" : "available";
      seats.push({ id: seat, status });
    }

    res.json({
      rows: ROWS,
      cols: COLS,
      show: publicShow(item.movie, item.show),
      seats,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/orders", requireAuth(["CUSTOMER"]), async (req, res, next) => {
  try {
    const { showId, seats } = req.body || {};
    if (!showId || !Array.isArray(seats) || seats.length === 0) {
      res.status(400).json({ error: "INVALID_ORDER_REQUEST" });
      return;
    }

    const item = findShow(showId);
    if (!item) {
      res.status(404).json({ error: "SHOW_NOT_FOUND" });
      return;
    }

    const uniqueSeats = Array.from(new Set(seats));
    const invalidSeat = uniqueSeats.find((seat) => !item.show.seats.includes(seat));
    if (invalidSeat) {
      res.status(400).json({ error: "INVALID_SEAT", seat: invalidSeat });
      return;
    }

    const soldSeat = uniqueSeats.find((seat) => item.show.sold.includes(seat));
    if (soldSeat) {
      res.status(409).json({ error: "SEAT_ALREADY_SOLD", seat: soldSeat });
      return;
    }

    const orderId = crypto.randomUUID();
    const lockedSeats = [];
    for (const seat of uniqueSeats) {
      const locked = await store.lockSeat(showId, seat, orderId, LOCK_TTL_SECONDS);
      if (!locked) {
        await Promise.all(lockedSeats.map((lockedSeat) => store.releaseSeat(showId, lockedSeat, orderId)));
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
      expiresAt: new Date(Date.now() + LOCK_TTL_SECONDS * 1000).toISOString(),
    };
    addOrder(order);
    ordersCreated.inc();
    await store.publishEvent("ORDER_CREATED", order);
    logger.info({ orderId, showId, seats: uniqueSeats, userId: req.user.id }, "order created");
    res.status(201).json({ order, lockTtlSeconds: LOCK_TTL_SECONDS });
  } catch (error) {
    next(error);
  }
});

app.post("/api/orders/:orderId/pay", requireAuth(["CUSTOMER", "ADMIN"]), async (req, res, next) => {
  try {
    const order = getOrders().find((item) => item.id === req.params.orderId);
    if (!order) {
      res.status(404).json({ error: "ORDER_NOT_FOUND" });
      return;
    }
    if (req.user.role !== "ADMIN" && order.userId !== req.user.id) {
      res.status(403).json({ error: "FORBIDDEN", message: "不能支付其他用户的订单" });
      return;
    }
    if (order.status !== "PENDING_PAYMENT") {
      res.status(409).json({ error: "ORDER_NOT_PAYABLE", status: order.status });
      return;
    }
    if (Date.parse(order.expiresAt) <= Date.now()) {
      await cancelOrder(order, "ORDER_EXPIRED");
      res.status(409).json({ error: "ORDER_EXPIRED" });
      return;
    }

    const item = findShow(order.showId);
    for (const seat of order.seats) {
      const owner = await store.getLockOwner(order.showId, seat);
      if (owner !== order.id) {
        await cancelOrder(order, "LOCK_LOST");
        res.status(409).json({ error: "LOCK_LOST", seat });
        return;
      }
    }

    for (const seat of order.seats) {
      await store.releaseSeat(order.showId, seat, order.id);
    }

    markSeatsSold(order.showId, order.seats);
    const paidOrder = updateOrder(order.id, (row) => {
      row.status = "PAID";
      row.paidAt = new Date().toISOString();
    });
    ordersPaid.inc();
    await store.publishEvent("ORDER_PAID", paidOrder);
    logger.info({ orderId: paidOrder.id, amount: paidOrder.amount }, "order paid");
    res.json({ order: paidOrder });
  } catch (error) {
    next(error);
  }
});

app.post("/api/orders/:orderId/cancel", requireAuth(["CUSTOMER", "ADMIN"]), async (req, res, next) => {
  try {
    const order = getOrders().find((item) => item.id === req.params.orderId);
    if (!order) {
      res.status(404).json({ error: "ORDER_NOT_FOUND" });
      return;
    }
    if (req.user.role !== "ADMIN" && order.userId !== req.user.id) {
      res.status(403).json({ error: "FORBIDDEN", message: "不能取消其他用户的订单" });
      return;
    }
    await cancelOrder(order, "USER_CANCELLED");
    res.json({ order });
  } catch (error) {
    next(error);
  }
});

app.get("/api/orders/:orderId", requireAuth(["CUSTOMER", "ADMIN"]), (req, res) => {
  const order = getOrders().find((item) => item.id === req.params.orderId);
  if (!order) {
    res.status(404).json({ error: "ORDER_NOT_FOUND" });
    return;
  }
  if (req.user.role !== "ADMIN" && order.userId !== req.user.id) {
    res.status(403).json({ error: "FORBIDDEN", message: "不能查看其他用户的订单" });
    return;
  }
  res.json({ order });
});

app.get("/api/my/orders", requireAuth(["CUSTOMER"]), (req, res) => {
  const rows = getOrders()
    .filter((order) => order.userId === req.user.id)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  res.json({ orders: rows });
});

app.get("/api/admin/dashboard", requireAuth(["ADMIN"]), async (_req, res, next) => {
  try {
    res.json(await buildAdminDashboard());
  } catch (error) {
    next(error);
  }
});

app.patch("/api/admin/shows/:showId/price", requireAuth(["ADMIN"]), async (req, res, next) => {
  try {
    const price = Number(req.body?.price);
    if (!Number.isFinite(price) || price < 1 || price > 999) {
      res.status(400).json({ error: "INVALID_PRICE", message: "票价需要在 1 到 999 之间" });
      return;
    }
    const show = updateShowPrice(req.params.showId, Math.round(price));
    if (!show) {
      res.status(404).json({ error: "SHOW_NOT_FOUND" });
      return;
    }
    const item = findShow(show.id);
    await store.publishEvent("PRICE_UPDATED", {
      showId: show.id,
      movieTitle: item.movie.title,
      price: show.price,
      operator: req.user.displayName,
    });
    res.json({ show: publicShow(item.movie, show) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/stats", async (_req, res, next) => {
  try {
    const movies = getMovies().map((movie) => {
      const totalSeats = movie.shows.reduce((sum, show) => sum + show.seats.length, 0);
      const soldSeats = movie.shows.reduce((sum, show) => sum + show.sold.length, 0);
      const revenue = movie.shows.reduce((sum, show) => sum + show.sold.length * show.price, 0);
      return {
        id: movie.id,
        title: movie.title,
        rating: movie.rating,
        heat: movie.heat,
        soldSeats,
        availableSeats: totalSeats - soldSeats,
        revenue,
        occupancyRate: Math.round((soldSeats / totalSeats) * 100),
      };
    });
    const events = await store.recentEvents(8);
    const allOrders = getOrders();
    const pendingOrders = allOrders.filter((order) => order.status === "PENDING_PAYMENT").length;
    res.json({
      redisMode: store.mode,
      pendingOrders,
      paidOrders: allOrders.filter((order) => order.status === "PAID").length,
      totalRevenue: allOrders
        .filter((order) => order.status === "PAID")
        .reduce((sum, order) => sum + order.amount, 0),
      movies,
      events,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/ops/events", async (_req, res, next) => {
  try {
    res.json({ events: await store.recentEvents(20) });
  } catch (error) {
    next(error);
  }
});

app.get("/metrics", async (_req, res) => {
  redisModeGauge.set(store.mode === "redis" ? 1 : 0);
  res.set("Content-Type", promClient.register.contentType);
  res.end(await promClient.register.metrics());
});

app.use((error, _req, res, _next) => {
  logger.error({ error: error.stack || error.message }, "unhandled request error");
  res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
});

function publicShow(movie, show) {
  return {
    id: show.id,
    movieId: movie.id,
    movieTitle: movie.title,
    startsAt: show.startsAt,
    price: show.price,
    hall: show.hall,
    cinema: show.cinema,
    address: show.address,
    distance: show.distance,
    format: show.format,
    language: show.language,
    serviceTags: show.serviceTags,
  };
}

async function buildAdminDashboard() {
  const allOrders = getOrders();
  const paidOrders = allOrders.filter((order) => order.status === "PAID");
  const pendingOrders = allOrders.filter((order) => order.status === "PENDING_PAYMENT");
  const shows = getShowsForAdmin();
  return {
    overview: {
      movies: getMovies().length,
      shows: shows.length,
      paidOrders: paidOrders.length,
      pendingOrders: pendingOrders.length,
      revenue: paidOrders.reduce((sum, order) => sum + order.amount, 0),
      soldSeats: shows.reduce((sum, show) => sum + show.soldSeats, 0),
    },
    shows,
    orders: allOrders
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, 30),
  };
}

async function cancelOrder(order, reason) {
  if (order.status !== "PENDING_PAYMENT") {
    return order;
  }
  await Promise.all(order.seats.map((seat) => store.releaseSeat(order.showId, seat, order.id)));
  const cancelled = updateOrder(order.id, (row) => {
    row.status = "CANCELLED";
    row.cancelReason = reason;
    row.cancelledAt = new Date().toISOString();
  });
  await store.publishEvent("ORDER_CANCELLED", cancelled);
  logger.info({ orderId: cancelled.id, reason }, "order cancelled");
  return cancelled;
}

async function start() {
  await store.connect();
  redisModeGauge.set(store.mode === "redis" ? 1 : 0);
  
  // 初始化搜索服务
  await searchService.connect();
  elasticsearchModeGauge.set(searchService.mode === "elasticsearch" ? 1 : 0);
  
  // 如果Elasticsearch连接成功，创建索引并导入数据
  if (searchService.mode === "elasticsearch") {
    try {
      const movies = getMovies();
      const cinemas = getCinemas();
      
      await searchService.indexMovies(movies);
      await searchService.indexCinemas(cinemas);
      
      logger.info("Elasticsearch data indexed successfully");
    } catch (error) {
      logger.error({ error: error.message }, "Failed to index data into Elasticsearch");
    }
  }
  
  const port = Number(process.env.PORT || 3000);
  return app.listen(port, () => {
    logger.info(`cinema ticket system listening on http://localhost:${port}`);
    logger.info(`Search mode: ${searchService.mode}`);
    logger.info(`Redis mode: ${store.mode}`);
  });
}

if (require.main === module) {
  start();
}

module.exports = {
  app,
  start,
  store,
  orders,
  searchService,
};
