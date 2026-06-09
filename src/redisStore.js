const { createClient } = require("redis");
const zookeeper = require("node-zookeeper-client");

// 缓存指标跟踪类
class CacheMetrics {
  constructor() {
    this.hits = {
      hot_movies: 0,
      search: 0,
      cinemas: 0,
      movie: 0,
      redis: 0,
      memory: 0
    };
    this.misses = {
      hot_movies: 0,
      search: 0,
      cinemas: 0,
      movie: 0
    };
    this.zkReady = false;
  }

  recordCacheHit(type, isRedis = true) {
    this.hits[type] = (this.hits[type] || 0) + 1;
    if (isRedis) {
      this.hits.redis++;
    } else {
      this.hits.memory++;
    }
  }

  recordCacheMiss(type) {
    this.misses[type] = (this.misses[type] || 0) + 1;
  }

  getStats() {
    const totalHits = Object.values(this.hits).reduce((a, b) => a + b, 0) - this.hits.redis - this.hits.memory;
    const totalRequests = totalHits + Object.values(this.misses).reduce((a, b) => a + b, 0);
    
    return {
      hits: { ...this.hits },
      misses: { ...this.misses },
      hitRate: totalRequests > 0 ? (totalHits / totalRequests) * 100 : 0,
      redisHitRatio: (this.hits.redis + this.hits.memory) > 0 ? 
        (this.hits.redis / (this.hits.redis + this.hits.memory)) * 100 : 0
    };
  }

  reset() {
    this.hits = { hot_movies: 0, search: 0, cinemas: 0, movie: 0, redis: 0, memory: 0 };
    this.misses = { hot_movies: 0, search: 0, cinemas: 0, movie: 0 };
  }
}

class RedisStore {
  constructor(logger) {
    this.logger = logger;
    this.client = null;
    this.mode = "memory";
    this.memoryLocks = new Map();
    this.memoryEvents = [];
    // 内存缓存作为降级
    this.memoryCache = new Map();
    // 缓存指标跟踪
    this.metrics = new CacheMetrics();
    this.metricsReporter = null;
  }

  setMetricsReporter(reporter) {
    this.metricsReporter = typeof reporter === "function" ? reporter : null;
  }

  emitMetric(type, event, backend = "redis") {
    if (this.metricsReporter) {
      this.metricsReporter(type, event, backend);
    }
  }

async init() {
  await this.connect();  // 先连 Redis
  await this.connectZooKeeper();  // 再连 ZK
}

async connectZooKeeper() {
  this.zkClient = zookeeper.createClient("127.0.0.1:2181");
  
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("ZooKeeper connection timeout"));
    }, 5000);
    
    this.zkClient.once("connected", () => {
      this.zkReady = true;
      this.logger.info("ZooKeeper connected");
      clearTimeout(timeout);
      resolve();
    });
    
    this.zkClient.once("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    
    this.zkClient.connect();
  });
}

ensurePath(path) {
  const parts = path.split("/").filter(Boolean);
  let current = "";

  for (const part of parts) {
    current += "/" + part;

    this.zkClient.exists(current, (err, stat) => {
      if (!stat) {
        if (!this.zkClient || !this.zkReady) {
          this.logger.warn("ZooKeeper not ready, fallback to Redis only");
          return this.lockSeatWithoutZK(showId, seat, orderId, ttlSeconds);
        }
      }
    });
  }
}

async lockSeatWithoutZK(showId, seat, orderId, ttlSeconds) {
  if (this.client) {
    const result = await this.client.set(this.lockKey(showId, seat), orderId, {
      NX: true,
      EX: ttlSeconds,
    });
    return result === "OK";
  }

  this.cleanupMemoryLocks();

  const key = this.lockKey(showId, seat);
  if (this.memoryLocks.has(key)) return false;

  this.memoryLocks.set(key, {
    owner: orderId,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });

  return true;
}

// RedisStore.js
async acquireGlobalLock(lockName, ttl = 5000) {
  if (!this.zkClient) {
    this.zkClient = zookeeper.createClient("127.0.0.1:2181");
    this.zkClient.connect();
  }

  const path = `/locks/${lockName}`;

  return new Promise((resolve, reject) => {
    this.zkClient.create(
      path,
      Buffer.from("locked"),
      zookeeper.CreateMode.EPHEMERAL,
      (error) => {
        if (error) {
          if (error.getCode() === zookeeper.Exception.NODE_EXISTS) {
            return resolve(false); // 已经有锁
          }
          return reject(error);
        }
        resolve(true); // 成功获取锁
      }
    );
  });
}

  releaseGlobalLock(lockName) {
    const path = `/locks/${lockName}`;

    this.zkClient.remove(path, -1, (err) => {
      if (err) {
        this.logger.warn({ err: err.message }, "ZK unlock failed");
      }
    });
  }

async canPlaceOrder(showId, userId) {
  const key = `limit:${showId}:${Math.floor(Date.now() / 10000)}`;

  let count;

  console.log("canPlaceOrder hit, mode =", this.mode, "client =", this.client?.isOpen);

  // ✅必须保证 Redis 真正可用
  if (this.client && this.mode === "redis" && this.client.isOpen) {
    count = await this.client.incr(key);
    if (count === 1) await this.client.expire(key, 10);
  } else {
    count = (this.memoryCache.get(key) || 0) + 1;
    this.memoryCache.set(key, count);
  }

  return count <= 5;
}

  async connect() {
    const client = createClient({
      RESP: 2,
      url: process.env.REDIS_URL || "redis://127.0.0.1:6379",
      socket: {
        connectTimeout: 1200,
        reconnectStrategy: false,
      },
      sentinels: [
        { host: "127.0.0.1", port: 26379 },
        { host: "127.0.0.1", port: 26380 }
      ]
    });

    client.on("error", (error) => {
      this.logger.warn({ error: error.message }, "redis connection issue");
    });

    try {
      await client.connect();
      await client.ping();
      this.client = client;
      this.mode = "redis";
      this.logger.info("redis connected");
    } catch (error) {
      this.mode = "memory";
      this.logger.warn({ error: error.message }, "redis unavailable, using in-memory fallback");
      try {
        await client.disconnect();
      } catch (_) {
        // Ignore disconnect failures from a client that never fully connected.
      }
    }
  }

  lockKey(showId, seat) {
    return `lock:${showId}:${seat}`;
  }

  cleanupMemoryLocks() {
    const now = Date.now();
    for (const [key, value] of this.memoryLocks) {
      if (value.expiresAt <= now) {
        this.memoryLocks.delete(key);
      }
    }
  }

// 添加新方法：递归创建路径
async ensurePathExists(path) {
  const parts = path.split("/").filter(Boolean);
  let current = "";
  
  for (const part of parts) {
    current += "/" + part;
    
    // 检查节点是否存在
    const exists = await new Promise((resolve) => {
      this.zkClient.exists(current, (err, stat) => {
        resolve(!!stat);
      });
    });
    
    if (!exists) {
      // 创建持久节点（父节点应该是持久的，只有叶子节点是 EPHEMERAL）
      await new Promise((resolve, reject) => {
        this.zkClient.create(current, Buffer.from(""), zookeeper.CreateMode.PERSISTENT, (err) => {
          if (err && err.getCode() !== zookeeper.Exception.NODE_EXISTS) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    }
  }
}

// 修改 lockSeat 方法
async lockSeat(showId, seat, orderId, ttlSeconds) {
  const zkPath = `/locks/seat/${showId}/${seat}`;
  
  if (!this.zkClient || !this.zkReady) {
    this.logger.warn("ZooKeeper not ready, fallback to Redis only");
    return this.lockSeatWithoutZK(showId, seat, orderId, ttlSeconds);
  }
  
  // 确保父路径存在
  try {
    await this.ensurePathExists(`/locks/seat/${showId}`);
  } catch (error) {
    this.logger.error({ error: error.message }, "Failed to create ZK parent path");
    return this.lockSeatWithoutZK(showId, seat, orderId, ttlSeconds);
  }
  
  return new Promise((resolve) => {
    this.zkClient.create(
      zkPath,
      Buffer.from(orderId),
      zookeeper.CreateMode.EPHEMERAL,
      async (err) => {
        if (err) {
          this.logger.warn({ showId, seat, orderId, error: err.message }, "ZK 锁座失败");
          return resolve(false);
        }
        
        // 成功后的逻辑...
        try {
          if (this.client) {
            await this.client.set(this.lockKey(showId, seat), orderId, {
              NX: true,
              EX: ttlSeconds,
            });
          } else {
            this.cleanupMemoryLocks();
            const key = this.lockKey(showId, seat);
            if (this.memoryLocks.has(key)) return resolve(false);
            
            this.memoryLocks.set(key, {
              owner: orderId,
              expiresAt: Date.now() + ttlSeconds * 1000,
            });
          }
          
          resolve(true);
        } catch (error) {
          resolve(false);
        }
      }
    );
  });
}

  async getLockOwner(showId, seat) {
    if (this.client) {
      return this.client.get(this.lockKey(showId, seat));
    }

    this.cleanupMemoryLocks();
    return this.memoryLocks.get(this.lockKey(showId, seat))?.owner || null;
  }

  async releaseSeat(showId, seat, orderId) {
    const key = this.lockKey(showId, seat);
    const owner = await this.getLockOwner(showId, seat);
    if (owner !== orderId) {
      return false;
    }

    if (this.client) {
      await this.client.del(key);
    } else {
      this.memoryLocks.delete(key);
    }
    return true;
  }

  async publishEvent(type, payload) {
    const event = {
      type,
      payload: JSON.stringify(payload),
      at: new Date().toISOString(),
    };

    if (this.client) {
      await this.client.lPush("cinema-booking-events", JSON.stringify(event));
      await this.client.lTrim("cinema-booking-events", 0, 49);
      return;
    }

    this.memoryEvents.unshift({
      id: `${Date.now()}-${this.memoryEvents.length}`,
      ...event,
    });
    this.memoryEvents = this.memoryEvents.slice(0, 50);
  }

  async recentEvents(limit = 20) {
    if (this.client) {
      const rows = await this.client.lRange("cinema-booking-events", 0, limit - 1);
      return rows.map((row, index) => ({
        id: `${index}-${row}`,
        ...JSON.parse(row),
      }));
    }
    return this.memoryEvents.slice(0, limit);
  }

  // ==================== 缓存功能 ====================
  
  // 生成缓存键
  cacheKey(type, identifier) {
    return `cache:${type}:${identifier}`;
  }

  // 设置缓存
  async setCache(type, identifier, data, ttlSeconds = 300) { // 默认5分钟
    const key = this.cacheKey(type, identifier);
    const value = JSON.stringify({
      data,
      cachedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString()
    });

    if (this.client) {
      try {
        await this.client.set(key, value, { EX: ttlSeconds });
        this.logger.debug({ type, identifier, ttlSeconds }, "缓存已设置到Redis");
      } catch (error) {
        this.logger.warn({ error: error.message, key }, "Redis缓存设置失败，使用内存缓存");
        this.setMemoryCache(key, value);
      }
    } else {
      this.setMemoryCache(key, value);
    }
  }

  // 获取缓存（带指标跟踪，Redis 未命中时回退内存二级缓存）
  async getCache(type, identifier, trackMetrics = true) {
    const key = this.cacheKey(type, identifier);
    let cachedValue = null;
    let hitBackend = "memory";

    if (this.client) {
      try {
        cachedValue = await this.client.get(key);
        if (cachedValue) {
          hitBackend = "redis";
        } else {
          cachedValue = this.getMemoryCache(key);
          if (cachedValue) {
            hitBackend = "memory";
          }
        }
      } catch (error) {
        this.logger.warn({ error: error.message, key }, "Redis缓存获取失败，尝试内存缓存");
        cachedValue = this.getMemoryCache(key);
        if (cachedValue) {
          hitBackend = "memory";
        }
      }
    } else {
      cachedValue = this.getMemoryCache(key);
      if (cachedValue) {
        hitBackend = "memory";
      }
    }

    if (!cachedValue) {
      if (trackMetrics && this.metrics) {
        this.metrics.recordCacheMiss(type);
        this.emitMetric(type, "miss", this.mode);
      }
      return null;
    }

    try {
      const parsed = JSON.parse(cachedValue);
      if (new Date(parsed.expiresAt) <= new Date()) {
        await this.deleteCache(type, identifier);
        if (trackMetrics && this.metrics) {
          this.metrics.recordCacheMiss(type);
          this.emitMetric(type, "miss", hitBackend);
        }
        return null;
      }

      if (trackMetrics && this.metrics) {
        this.metrics.recordCacheHit(type, hitBackend === "redis");
        this.emitMetric(type, "hit", hitBackend);
      }
      return parsed.data;
    } catch (error) {
      this.logger.warn({ error: error.message, key }, "缓存数据解析失败");
      if (trackMetrics && this.metrics) {
        this.metrics.recordCacheMiss(type);
        this.emitMetric(type, "miss", hitBackend);
      }
      return null;
    }
  }

  // 删除缓存
  async deleteCache(type, identifier) {
    const key = this.cacheKey(type, identifier);
    
    if (this.client) {
      try {
        await this.client.del(key);
      } catch (error) {
        this.logger.warn({ error: error.message, key }, "Redis缓存删除失败");
      }
    }
    
    this.deleteMemoryCache(key);
  }

  // 清空特定类型的缓存
  async clearCacheType(type) {
    if (this.client) {
      try {
        const keys = await this.client.keys(`cache:${type}:*`);
        if (keys.length > 0) {
          await this.client.del(keys);
          this.logger.info({ type, count: keys.length }, "清空缓存类型");
        }
      } catch (error) {
        this.logger.warn({ error: error.message, type }, "清空缓存类型失败");
      }
    }
    
    // 同时清空内存缓存
    for (const key of this.memoryCache.keys()) {
      if (key.startsWith(`cache:${type}:`)) {
        this.memoryCache.delete(key);
      }
    }
  }

  // 内存缓存辅助方法
  setMemoryCache(key, value) {
    this.memoryCache.set(key, value);
  }

  getMemoryCache(key) {
    const value = this.memoryCache.get(key);
    if (value) {
      try {
        const parsed = JSON.parse(value);
        if (new Date(parsed.expiresAt) <= new Date()) {
          this.memoryCache.delete(key);
          return null;
        }
      } catch (error) {
        this.memoryCache.delete(key);
        return null;
      }
    }
    return value;
  }

  deleteMemoryCache(key) {
    this.memoryCache.delete(key);
  }

  // 清理过期的内存缓存
  cleanupMemoryCache() {
    const now = new Date();
    for (const [key, value] of this.memoryCache) {
      try {
        const parsed = JSON.parse(value);
        if (new Date(parsed.expiresAt) <= now) {
          this.memoryCache.delete(key);
        }
      } catch (error) {
        this.memoryCache.delete(key);
      }
    }
  }

  // ==================== 具体业务缓存方法 ====================

  static BROWSE_CACHE_TYPES = ["movies", "hot_movies", "cinemas", "search", "movie"];

  // 全量影片列表（影片浏览页主数据）
  async cacheMoviesList(movies, ttlSeconds = 600) {
    await this.setCache("movies", "all", movies, ttlSeconds);
  }

  async getMoviesList() {
    return await this.getCache("movies", "all");
  }

  // 热门影片 Top N（按热度排序）
  async cacheHotMovies(movies, ttlSeconds = 600) {
    await this.setCache("hot_movies", "all", movies, ttlSeconds);
  }

  async getHotMovies() {
    return await this.getCache("hot_movies", "all");
  }

  async warmBrowseCache(movies, cinemas, hotLimit = 10) {
    await this.cacheMoviesList(movies);
    await this.cacheCinemas(cinemas);
    const hotMovies = [...movies].sort((a, b) => b.heat - a.heat).slice(0, hotLimit);
    await this.cacheHotMovies(hotMovies);
    this.logger.info(
      { movies: movies.length, cinemas: cinemas.length, hotMovies: hotMovies.length },
      "browse cache warmed",
    );
  }

  async invalidateBrowseCache() {
    const types = ["movies", "hot_movies", "cinemas", "search"];
    for (const type of types) {
      await this.clearCacheType(type);
    }
    this.logger.info({ types }, "browse cache invalidated");
  }

  // 搜索结果缓存
  async cacheSearchResults(query, results, ttlSeconds = 300) { // 默认5分钟
    const normalizedQuery = query.trim().toLowerCase();
    await this.setCache('search', normalizedQuery, results, ttlSeconds);
  }

  async getSearchResults(query) {
    const normalizedQuery = query.trim().toLowerCase();
    return await this.getCache('search', normalizedQuery);
  }

  // 影院信息缓存
  async cacheCinemas(cinemas, ttlSeconds = 1800) { // 默认30分钟
    await this.setCache('cinemas', 'all', cinemas, ttlSeconds);
  }

  async getCinemas() {
    return await this.getCache('cinemas', 'all');
  }

  // 单个影片缓存
  async cacheMovie(movieId, movieData, ttlSeconds = 1800) { // 默认30分钟
    await this.setCache('movie', movieId, movieData, ttlSeconds);
  }

  async getMovie(movieId) {
    return await this.getCache('movie', movieId);
  }

  // 获取缓存统计信息
  async getCacheStats() {
    const stats = {
      mode: this.mode,
      memoryCacheSize: this.memoryCache.size,
      metrics: this.metrics.getStats()
    };

    if (this.client) {
      try {
        const info = await this.client.info('memory');
        stats.redisMemory = info.split('\r\n').find(line => line.startsWith('used_memory:'))?.split(':')[1];
        
        // 获取各种缓存类型的数量
        const cacheTypes = RedisStore.BROWSE_CACHE_TYPES;
        for (const type of cacheTypes) {
          const keys = await this.client.keys(`cache:${type}:*`);
          stats[`${type}_count`] = keys.length;
        }

        // 获取更多Redis信息
        try {
          const dbsize = await this.client.dbSize();
          stats.redisKeyCount = dbsize;
        } catch (e) {
          // 忽略错误
        }
      } catch (error) {
        stats.redisError = error.message;
      }
    }

    return stats;
  }

  async close() {
    if (this.client) {
      await this.client.quit();
    }
  }
}

module.exports = RedisStore;
