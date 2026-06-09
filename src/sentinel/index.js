// src/sentinel/index.js
const { CircuitBreaker } = require('./circuitBreaker');
const { HotParamRateLimiter } = require('./rateLimiter');
const { DegradationManager } = require('./degradationManager');

class SentinelManager {
  constructor(store, searchService, logger) {
    this.store = store;
    this.searchService = searchService;
    this.logger = logger;
    
    // 熔断器实例
    this.circuitBreakers = new Map();
    
    // 限流器
    this.rateLimiter = new HotParamRateLimiter();
    
    // 降级管理器
    this.degradationManager = new DegradationManager(store, searchService, logger);
    
    // 初始化配置
    this.initConfigs();
  }

  initConfigs() {
    // 配置热点资源限流规则
    this.rateLimiter.configureResource('createOrder', {
      algorithm: 'token_bucket',
      capacity: 100,      // 100个令牌容量
      rate: 20,          // 每秒补充20个令牌
      userLimit: 2,      // 每用户每秒最多2次请求
      userLimitWindow: 1000
    });
    
    this.rateLimiter.configureResource('search', {
      algorithm: 'token_bucket',
      capacity: 200,
      rate: 50,
      userLimit: 5,
      userLimitWindow: 1000
    });
    
    this.rateLimiter.configureResource('payment', {
      algorithm: 'leaky_bucket',
      capacity: 50,
      rate: 10,
      userLimit: 1,
      userLimitWindow: 2000
    });
    
    // 预创建热门场次的熔断器
    this.createCircuitBreaker('createOrder:s1', {
      slowCallThreshold: 0.5,
      errorThreshold: 0.3,
      minRequestAmount: 10,
      waitDurationInOpenState: 60000,
      slowCallDurationThreshold: 500
    });
    
    this.createCircuitBreaker('createOrder:s2', {
      slowCallThreshold: 0.6,
      errorThreshold: 0.4,
      minRequestAmount: 10,
      waitDurationInOpenState: 30000
    });
    
    this.createCircuitBreaker('search', {
      slowCallThreshold: 0.7,
      errorThreshold: 0.5,
      minRequestAmount: 20,
      waitDurationInOpenState: 30000
    });
    
    this.createCircuitBreaker('payment', {
      slowCallThreshold: 0.4,
      errorThreshold: 0.2,
      minRequestAmount: 5,
      waitDurationInOpenState: 120000
    });
  }

  // 创建或获取熔断器
  getCircuitBreaker(resource, options = {}) {
    if (!this.circuitBreakers.has(resource)) {
      this.createCircuitBreaker(resource, options);
    }
    return this.circuitBreakers.get(resource);
  }

  createCircuitBreaker(resource, options) {
    const cb = new CircuitBreaker(resource, options);
    
    // 监听状态变更
    cb.on('stateChange', (event) => {
      this.logger.info({ resource: event.resource, from: event.from, to: event.to }, 'Circuit breaker state changed');
      
      // 更新降级管理器的指标
      if (event.to === 'OPEN') {
        this.degradationManager.updateMetrics({ errorRate: 0.5 });
      }
    });
    
    this.circuitBreakers.set(resource, cb);
    return cb;
  }

  // 带熔断保护的调用
  async withCircuitBreaker(resource, fn, fallback, options = {}) {
    const cb = this.getCircuitBreaker(resource, options);
    return await cb.call(fn, fallback);
  }

  // 带限流的调用
  async withRateLimit(resource, param, userId, fn) {
    const result = this.rateLimiter.tryAcquire(resource, param, userId);
    
    if (!result.allowed) {
      this.logger.warn({ resource, param, userId, reason: result.reason }, 'Rate limit exceeded');
      return {
        error: 'RATE_LIMITED',
        message: result.reason === 'USER_RATE_LIMIT' ? '操作太频繁，请稍后再试' : '当前访问量过大，请稍后再试',
        retryAfter: result.retryAfter,
        degraded: true
      };
    }
    
    return await fn();
  }

  // 带降级的调用
  async withDegradation(type, data, fn) {
    switch (type) {
      case 'createOrder':
        return await this.degradationManager.degradeCreateOrder(
          data.showId, data.seats, data.userId, fn
        );
      case 'search':
        return await this.degradationManager.degradeSearch(
          data.query, data.limit, fn
        );
      case 'cache':
        return await this.degradationManager.degradeCache(
          data.type, data.identifier, fn
        );
      default:
        return await fn();
    }
  }

  // 全链路保护（限流 + 熔断 + 降级）
  async protect(resource, param, userId, fn, fallback, options = {}) {
    // 1. 先检查降级级别（快速失败）
    const strategy = this.degradationManager.getCurrentStrategy();
    if (!strategy.enabled && resource.startsWith('createOrder')) {
      return {
        error: 'SERVICE_DEGRADED',
        message: '系统维护中，请稍后再试',
        degraded: true
      };
    }
    
    // 2. 限流检查
    const rateLimitResult = await this.withRateLimit(resource, param, userId, async () => ({ allowed: true }));
    if (rateLimitResult.error) {
      return rateLimitResult;
    }
    
    // 3. 熔断保护执行
    return await this.withCircuitBreaker(
      `${resource}:${param}`,
      async () => {
        // 4. 降级策略包装
        return await this.withDegradation(
          resource === 'createOrder' ? 'createOrder' : 
          resource === 'search' ? 'search' : null,
          { showId: param, seats: options.seats, userId, query: param, limit: options.limit },
          fn
        );
      },
      fallback,
      options
    );
  }

  // 获取所有状态
  getStatus() {
    const status = {
      degradation: this.degradationManager.getStatus(),
      circuitBreakers: {},
      rateLimiter: {},
      timestamp: new Date().toISOString()
    };
    
    for (const [resource, cb] of this.circuitBreakers) {
      status.circuitBreakers[resource] = cb.getState();
    }
    
    status.rateLimiter = this.rateLimiter.getStats('createOrder');
    
    return status;
  }

  // 手动设置降级级别（管理员接口）
  setDegradationLevel(level) {
    if (level >= 0 && level <= 2) {
      this.degradationManager.currentLevel = level;
      this.logger.warn({ level }, 'Manual degradation level set');
      return true;
    }
    return false;
  }

  // 手动重置熔断器
  resetCircuitBreaker(resource) {
    if (this.circuitBreakers.has(resource)) {
      const cb = this.circuitBreakers.get(resource);
      cb.transitionToClosed();
      return true;
    }
    return false;
  }

  destroy() {
    for (const cb of this.circuitBreakers.values()) {
      cb.destroy();
    }
    this.degradationManager.destroy();
  }
}

module.exports = { SentinelManager };