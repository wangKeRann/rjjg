const crypto = require("node:crypto");
const path = require("node:path");
const express = require("express");
const promClient = require("prom-client");
const { issueSession, permissionsForRole, requireAuth, requirePermission, revokeSession, verifyLogin } = require("./auth");
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
const { connectRabbitMQ, sendOrderEvent, getConnectionStatus } = require('./rabbitmqClient');
const { orderLogger } = require('./logger');
const { payOrder: orderPay, cancelOrder: orderCancel } = require('./orderService');

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
const MAX_SEATS_PER_ORDER = 4;

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
  debug(messageOrFields, message) {
    writeLog("debug", messageOrFields, message);
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
// 缓存相关指标
const cacheHits = new promClient.Counter({
  name: "cinema_cache_hits_total",
  help: "Total number of cache hits",
  labelNames: ["type"],
});
const cacheMisses = new promClient.Counter({
  name: "cinema_cache_misses_total",
  help: "Total number of cache misses",
  labelNames: ["type"],
});
const cacheSizeGauge = new promClient.Gauge({
  name: "cinema_cache_memory_size",
  help: "Number of items in memory cache",
});

store.setMetricsReporter((type, event) => {
  if (event === "hit") {
    cacheHits.labels(type).inc();
  } else {
    cacheMisses.labels(type).inc();
  }
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

app.get("/api/health", async (_req, res) => {
  redisModeGauge.set(store.mode === "redis" ? 1 : 0);
  elasticsearchModeGauge.set(searchService.mode === "elasticsearch" ? 1 : 0);
  
  // 获取缓存统计信息
  let cacheStats = {};
  try {
    cacheStats = await store.getCacheStats();
  } catch (error) {
    logger.warn({ error: error.message }, "获取缓存统计失败");
  }
  
  res.json({
    status: "UP",
    redis: store.mode,
    elasticsearch: searchService.mode,
    cache: {
      mode: cacheStats.mode || "unknown",
      memorySize: cacheStats.memoryCacheSize || 0,
      hitRate: cacheStats.metrics?.hitRate ?? 0,
      enabled: true,
    },
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
    permissions: permissionsForRole(user.role),
    tokenType: "Bearer",
    expiresIn: Number(process.env.JWT_TTL_SECONDS || 60 * 60 * 8),
    portal: role === "ADMIN" ? "admin" : "customer",
    redirect: role === "ADMIN" ? "#admin" : "#booking",
  });
});

app.post("/api/auth/logout", requireAuth(), (req, res) => {
  revokeSession(req.token);
  res.json({ ok: true });
});

app.get("/api/me", requireAuth(), (req, res) => {
  res.json({ user: req.user, permissions: req.auth.permissions, claims: req.auth.claims });
});

app.get("/api/movies", async (_req, res) => {
  try {
    const cachedMovies = await store.getMoviesList();
    if (cachedMovies) {
      logger.debug("从缓存获取影片列表");
      res.json({ movies: cachedMovies, cached: true, source: store.mode });
      return;
    }

    const movies = getMovies();
    await store.cacheMoviesList(movies);
    const hotMovies = [...movies].sort((a, b) => b.heat - a.heat).slice(0, 10);
    await store.cacheHotMovies(hotMovies);
    logger.debug("影片列表与热门影片已写入缓存");

    res.json({ movies, cached: false, source: store.mode });
  } catch (error) {
    logger.error({ error: error.message }, "获取影片数据失败");
    res.json({ movies: getMovies(), cached: false, error: "缓存服务暂时不可用" });
  }
});

app.get("/api/movies/hot", async (_req, res) => {
  try {
    const cached = await store.getHotMovies();
    if (cached) {
      res.json({ movies: cached, cached: true, source: store.mode });
      return;
    }

    const movies = getMovies();
    const hotMovies = [...movies].sort((a, b) => b.heat - a.heat).slice(0, 10);
    await store.cacheHotMovies(hotMovies);
    res.json({ movies: hotMovies, cached: false, source: store.mode });
  } catch (error) {
    logger.error({ error: error.message }, "获取热门影片失败");
    const hotMovies = [...getMovies()].sort((a, b) => b.heat - a.heat).slice(0, 10);
    res.json({ movies: hotMovies, cached: false, error: "缓存服务暂时不可用" });
  }
});

app.get("/api/cinemas", async (_req, res) => {
  try {
    // 首先尝试从缓存获取影院数据
    const cachedCinemas = await store.getCinemas();
    if (cachedCinemas) {
      logger.debug("从缓存获取影院数据");
      res.json({ cinemas: cachedCinemas, cached: true, source: store.mode });
      return;
    }

    const cinemas = getCinemas();
    await store.cacheCinemas(cinemas);
    logger.debug("影院数据已缓存");

    res.json({ cinemas, cached: false, source: store.mode });
  } catch (error) {
    logger.error({ error: error.message }, "获取影院数据失败");
    // 降级：直接返回数据库数据
    res.json({ cinemas: getCinemas(), cached: false, error: "缓存服务暂时不可用" });
  }
});

app.get("/api/search", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const limit = parseInt(req.query.limit) || 50;
    
    if (!q) {
      res.json({ q, movies: [], cinemas: [] });
      return;
    }
    
    // 首先尝试从缓存获取搜索结果
    const cachedResult = await store.getSearchResults(q);
    if (cachedResult) {
      logger.debug({ query: q }, "从缓存获取搜索结果");
      res.json({ ...cachedResult, cached: true, source: store.mode });
      return;
    }
    
    let result;
    if (searchService.mode === 'elasticsearch') {
      result = await searchService.search(q, { limit });
    } else {
      // 内存搜索降级
      const movies = getMovies();
      const cinemas = getCinemas();
      result = searchService.searchInMemory(q, { limit }, movies, cinemas);
    }
    
    // 缓存搜索结果（热门搜索词缓存时间更长）
    const isPopularQuery = ['imax', 'vip', '科幻', '滨江', '上海'].includes(q.toLowerCase());
    const ttlSeconds = isPopularQuery ? 600 : 300; // 热门搜索10分钟，普通搜索5分钟
    
    await store.cacheSearchResults(q, result, ttlSeconds);
    logger.debug({ query: q, ttlSeconds }, "搜索结果已缓存");
    
    res.json({ ...result, cached: false, source: store.mode });
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

app.post("/api/orders", requirePermission("order:create"), async (req, res, next) => {
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

    const uniqueSeats = Array.from(new Set(seats.map((seat) => String(seat || "").trim()).filter(Boolean)));
    if (uniqueSeats.length === 0 || uniqueSeats.length > MAX_SEATS_PER_ORDER) {
      res.status(400).json({
        error: "INVALID_SEAT_COUNT",
        maxSeats: MAX_SEATS_PER_ORDER,
      });
      return;
    }

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

app.post("/api/orders/:orderId/pay", requirePermission("order:pay:self", "order:pay:any"), async (req, res, next) => {
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

app.post("/api/orders/:orderId/cancel", requirePermission("order:cancel:self", "order:cancel:any"), async (req, res, next) => {
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

app.get("/api/orders/:orderId", requirePermission("order:read:self", "order:read:any"), (req, res) => {
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

app.get("/api/my/orders", requirePermission("order:read:self"), (req, res) => {
  const rows = getOrders()
    .filter((order) => order.userId === req.user.id)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  res.json({ orders: rows });
});

app.get("/api/admin/dashboard", requirePermission("admin:dashboard"), async (_req, res, next) => {
  try {
    res.json(await buildAdminDashboard());
  } catch (error) {
    next(error);
  }
});

app.patch("/api/admin/shows/:showId/price", requirePermission("show:price:update"), async (req, res, next) => {
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
    await store.invalidateBrowseCache();
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

// 缓存统计API
app.get("/api/cache/stats", async (_req, res, next) => {
  try {
    const cacheStats = await store.getCacheStats();
    res.json({
      cache: cacheStats,
      searchMode: searchService.mode,
      redisMode: store.mode,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
});

// 清空缓存 API（管理员使用）
app.delete("/api/cache/clear", requirePermission("cache:manage"), async (_req, res, next) => {
  try {
    const cacheTypes = [...RedisStore.BROWSE_CACHE_TYPES];
    for (const cacheType of cacheTypes) {
      await store.clearCacheType(cacheType);
    }
    res.json({
      message: "已清空所有缓存",
      cleared: true,
      types: cacheTypes,
    });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/cache/clear/:type", requirePermission("cache:manage"), async (req, res, next) => {
  try {
    const { type } = req.params;
    await store.clearCacheType(type);
    res.json({
      message: `已清空 ${type} 类型缓存`,
      type,
      cleared: true,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/stats", requirePermission("admin:dashboard"), async (_req, res, next) => {
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

app.get("/api/ops/events", requirePermission("ops:view"), async (_req, res, next) => {
  try {
    res.json({ events: await store.recentEvents(20) });
  } catch (error) {
    next(error);
  }
});

app.get("/metrics", async (_req, res) => {
  redisModeGauge.set(store.mode === "redis" ? 1 : 0);
  elasticsearchModeGauge.set(searchService.mode === "elasticsearch" ? 1 : 0);
  cacheSizeGauge.set(store.memoryCache.size);
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

  // 初始化 RabbitMQ（非阻塞，失败不影响主服务）
  try {
    await connectRabbitMQ();
    logger.info('RabbitMQ 初始化完成');
  } catch (error) {
    logger.warn('RabbitMQ 初始化失败，将使用 Outbox 队列模式', { error: error.message });
  }
  
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

  try {
    await store.warmBrowseCache(getMovies(), getCinemas());
  } catch (error) {
    logger.warn({ error: error.message }, "browse cache warm-up skipped");
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
