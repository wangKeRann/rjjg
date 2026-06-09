// src/sentinel/rateLimiter.js
class TokenBucketLimiter {
  constructor(capacity, refillRate) {
    this.capacity = capacity;      // 桶容量
    this.refillRate = refillRate;  // 每秒补充令牌数
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  tryAcquire(amount = 1) {
    this.refill();
    
    if (this.tokens >= amount) {
      this.tokens -= amount;
      return true;
    }
    return false;
  }

  refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    const newTokens = elapsed * this.refillRate;
    this.tokens = Math.min(this.capacity, this.tokens + newTokens);
    this.lastRefill = now;
  }

  getAvailableTokens() {
    this.refill();
    return this.tokens;
  }
}

class LeakyBucketLimiter {
  constructor(capacity, leakRate) {
    this.capacity = capacity;      // 队列容量
    this.leakRate = leakRate;      // 每秒漏出数量
    this.queue = 0;
    this.lastLeak = Date.now();
  }

  tryAcquire(amount = 1) {
    this.leak();
    
    if (this.queue + amount <= this.capacity) {
      this.queue += amount;
      return true;
    }
    return false;
  }

  leak() {
    const now = Date.now();
    const elapsed = (now - this.lastLeak) / 1000;
    const leaked = elapsed * this.leakRate;
    this.queue = Math.max(0, this.queue - leaked);
    this.lastLeak = now;
  }

  getQueueSize() {
    this.leak();
    return this.queue;
  }
}

// 热点参数限流器
class HotParamRateLimiter {
  constructor() {
    // 资源配置：resource -> param -> limiter
    this.resourceConfigs = new Map();
    // 默认配置
    this.defaultConfig = {
      algorithm: 'token_bucket',  // token_bucket 或 leaky_bucket
      capacity: 100,              // 桶容量
      rate: 20,                  // 每秒令牌数/漏出数
      userLimit: 2,              // 每用户每秒限制
      userLimitWindow: 1000      // 用户限流窗口(ms)
    };
    
    // 用户请求记录（防刷）
    this.userRequests = new Map();
  }

  // 配置资源限流规则
  configureResource(resource, config) {
    this.resourceConfigs.set(resource, { ...this.defaultConfig, ...config });
  }

  // 获取或创建限流器
  getLimiter(resource, param) {
    const config = this.resourceConfigs.get(resource) || this.defaultConfig;
    const key = `${resource}:${param}`;
    
    if (!this.limiters) {
      this.limiters = new Map();
    }
    
    if (!this.limiters.has(key)) {
      let limiter;
      if (config.algorithm === 'token_bucket') {
        limiter = new TokenBucketLimiter(config.capacity, config.rate);
      } else {
        limiter = new LeakyBucketLimiter(config.capacity, config.rate);
      }
      this.limiters.set(key, limiter);
    }
    
    return { limiter: this.limiters.get(key), config };
  }

  // 检查用户限流
  checkUserLimit(resource, userId, config) {
    const userKey = `${resource}:${userId}`;
    const now = Date.now();
    
    const userRecord = this.userRequests.get(userKey);
    if (!userRecord) {
      this.userRequests.set(userKey, { count: 1, timestamp: now });
      return true;
    }
    
    if (now - userRecord.timestamp < config.userLimitWindow) {
      if (userRecord.count >= config.userLimit) {
        return false;
      }
      userRecord.count++;
    } else {
      userRecord.count = 1;
      userRecord.timestamp = now;
    }
    
    return true;
  }

  // 尝试获取许可
  tryAcquire(resource, param, userId) {
    const { limiter, config } = this.getLimiter(resource, param);
    
    // 全局限流
    const globalAllowed = limiter.tryAcquire();
    if (!globalAllowed) {
      return { allowed: false, reason: 'GLOBAL_RATE_LIMIT', retryAfter: 1000 };
    }
    
    // 用户限流
    const userAllowed = this.checkUserLimit(resource, userId, config);
    if (!userAllowed) {
      return { allowed: false, reason: 'USER_RATE_LIMIT', retryAfter: config.userLimitWindow };
    }
    
    // 清理过期的用户记录
    this.cleanupUserRecords();
    
    return { allowed: true };
  }

  cleanupUserRecords() {
    const now = Date.now();
    const expireTime = 5000;
    for (const [key, record] of this.userRequests) {
      if (now - record.timestamp > expireTime) {
        this.userRequests.delete(key);
      }
    }
    
    if (this.userRequests.size > 10000) {
      // 如果记录太多，清理超过1秒的
      for (const [key, record] of this.userRequests) {
        if (now - record.timestamp > 1000) {
          this.userRequests.delete(key);
        }
      }
    }
  }

  getStats(resource) {
    const stats = {};
    if (this.limiters) {
      for (const [key, limiter] of this.limiters) {
        if (key.startsWith(resource)) {
          stats[key] = {
            availableTokens: limiter.getAvailableTokens ? limiter.getAvailableTokens() : limiter.getQueueSize()
          };
        }
      }
    }
    return stats;
  }
}

module.exports = { HotParamRateLimiter, TokenBucketLimiter, LeakyBucketLimiter };