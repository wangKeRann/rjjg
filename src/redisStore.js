const { createClient } = require("redis");

class RedisStore {
  constructor(logger) {
    this.logger = logger;
    this.client = null;
    this.mode = "memory";
    this.memoryLocks = new Map();
    this.memoryEvents = [];
  }

  async connect() {
    const client = createClient({
      RESP: 2,
      url: process.env.REDIS_URL || "redis://127.0.0.1:6379",
      socket: {
        connectTimeout: 1200,
        reconnectStrategy: false,
      },
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

  async lockSeat(showId, seat, orderId, ttlSeconds) {
    if (this.client) {
      const result = await this.client.set(this.lockKey(showId, seat), orderId, {
        NX: true,
        EX: ttlSeconds,
      });
      return result === "OK";
    }

    this.cleanupMemoryLocks();
    const key = this.lockKey(showId, seat);
    if (this.memoryLocks.has(key)) {
      return false;
    }
    this.memoryLocks.set(key, {
      owner: orderId,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
    return true;
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

  async close() {
    if (this.client) {
      await this.client.quit();
    }
  }
}

module.exports = RedisStore;
