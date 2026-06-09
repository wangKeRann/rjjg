// src/sentinel/circuitBreaker.js
const EventEmitter = require('events');

// 熔断器状态
const State = {
  CLOSED: 'CLOSED',      // 关闭状态（正常）
  OPEN: 'OPEN',          // 打开状态（熔断）
  HALF_OPEN: 'HALF_OPEN' // 半开状态（探测恢复）
};

// 滑动窗口指标统计
class SlidingWindowMetrics {
  constructor(windowSizeMs = 60000, bucketCount = 10) {
    this.windowSize = windowSizeMs;
    this.bucketCount = bucketCount;
    this.bucketSize = windowSizeMs / bucketCount;
    this.buckets = [];
    this.currentBucket = null;
    this.initialize();
  }

  initialize() {
    const now = Date.now();
    for (let i = 0; i < this.bucketCount; i++) {
      this.buckets.push({
        startTime: now - (this.bucketCount - i) * this.bucketSize,
        total: 0,
        errors: 0,
        slowCalls: 0,
        sumDuration: 0
      });
    }
    this.currentBucket = this.buckets[this.buckets.length - 1];
  }

  getCurrentBucket() {
    const now = Date.now();
    if (now - this.currentBucket.startTime >= this.bucketSize) {
      // 创建新桶
      const newBucket = {
        startTime: now,
        total: 0,
        errors: 0,
        slowCalls: 0,
        sumDuration: 0
      };
      this.buckets.push(newBucket);
      // 移除过期桶
      const cutoff = now - this.windowSize;
      while (this.buckets.length > 0 && this.buckets[0].startTime < cutoff) {
        this.buckets.shift();
      }
      this.currentBucket = newBucket;
    }
    return this.currentBucket;
  }

  record(success, duration, slowThreshold = 500) {
    const bucket = this.getCurrentBucket();
    bucket.total++;
    if (!success) bucket.errors++;
    if (duration > slowThreshold) bucket.slowCalls++;
    bucket.sumDuration += duration;
  }

  getMetrics() {
    const total = this.buckets.reduce((sum, b) => sum + b.total, 0);
    const errors = this.buckets.reduce((sum, b) => sum + b.errors, 0);
    const slowCalls = this.buckets.reduce((sum, b) => sum + b.slowCalls, 0);
    const totalDuration = this.buckets.reduce((sum, b) => sum + b.sumDuration, 0);

    return {
      total,
      errorRate: total > 0 ? errors / total : 0,
      slowCallRate: total > 0 ? slowCalls / total : 0,
      avgRt: total > 0 ? totalDuration / total : 0
    };
  }

  reset() {
    this.initialize();
  }
}

// 熔断器
class CircuitBreaker extends EventEmitter {
  constructor(resource, options = {}) {
    super();
    this.resource = resource;
    this.state = State.CLOSED;
    this.metrics = new SlidingWindowMetrics(
      options.windowSize || 60000,
      options.bucketCount || 10
    );
    
    // 配置
    this.slowCallThreshold = options.slowCallThreshold || 0.5; // 50% 慢调用比例
    this.errorThreshold = options.errorThreshold || 0.3;       // 30% 错误率
    this.minRequestAmount = options.minRequestAmount || 10;    // 最小请求数
    this.waitDurationInOpenState = options.waitDurationInOpenState || 60000; // 熔断持续时间
    this.slowCallDurationThreshold = options.slowCallDurationThreshold || 500; // 慢调用阈值(ms)
    
    this.openTime = null;
    this.halfOpenRequests = 0;
    this.maxHalfOpenRequests = options.maxHalfOpenRequests || 5;
    
    // 启动状态检查定时器
    this.startStateChecker();
  }

  startStateChecker() {
    this.checkInterval = setInterval(() => {
      if (this.state === State.OPEN) {
        const now = Date.now();
        if (now - this.openTime >= this.waitDurationInOpenState) {
          this.transitionToHalfOpen();
        }
      }
    }, 1000);
  }

  transitionToClosed() {
    this.state = State.CLOSED;
    this.metrics.reset();
    this.openTime = null;
    this.halfOpenRequests = 0;
    this.emit('stateChange', { resource: this.resource, from: State.OPEN, to: State.CLOSED });
    console.log(`[CircuitBreaker] ${this.resource} -> CLOSED`);
  }

  transitionToOpen() {
    this.state = State.OPEN;
    this.openTime = Date.now();
    this.emit('stateChange', { resource: this.resource, from: State.CLOSED, to: State.OPEN });
    console.warn(`[CircuitBreaker] ${this.resource} -> OPEN (熔断触发)`);
  }

  transitionToHalfOpen() {
    this.state = State.HALF_OPEN;
    this.halfOpenRequests = 0;
    this.emit('stateChange', { resource: this.resource, from: State.OPEN, to: State.HALF_OPEN });
    console.log(`[CircuitBreaker] ${this.resource} -> HALF_OPEN (探测恢复)`);
  }

  async call(fn, fallback) {
    // 熔断状态：直接执行降级
    if (this.state === State.OPEN) {
      console.warn(`[CircuitBreaker] ${this.resource} is OPEN, executing fallback`);
      return await this.executeFallback(fallback);
    }

    // 半开状态：限流探测
    if (this.state === State.HALF_OPEN) {
      if (this.halfOpenRequests >= this.maxHalfOpenRequests) {
        console.warn(`[CircuitBreaker] ${this.resource} HALF_OPEN, too many probe requests`);
        return await this.executeFallback(fallback);
      }
      this.halfOpenRequests++;
    }

    const startTime = Date.now();
    let success = false;
    let result = null;
    let error = null;

    try {
      result = await fn();
      success = true;
      return result;
    } catch (err) {
      error = err;
      throw err;
    } finally {
      const duration = Date.now() - startTime;
      this.metrics.record(success, duration, this.slowCallDurationThreshold);
      
      // 只在 CLOSED 状态下检查是否需要熔断
      if (this.state === State.CLOSED) {
        this.checkCircuitBreaker();
      }
      
      // 半开状态下的请求结果处理
      if (this.state === State.HALF_OPEN) {
        if (success) {
          // 探测成功，关闭熔断器
          this.transitionToClosed();
        } else {
          // 探测失败，重新熔断
          this.transitionToOpen();
        }
      }
    }
  }

  checkCircuitBreaker() {
    const metrics = this.metrics.getMetrics();
    
    // 请求数不足，不触发熔断
    if (metrics.total < this.minRequestAmount) {
      return;
    }

    let shouldOpen = false;
    let reason = '';

    // 检查慢调用比例
    if (metrics.slowCallRate >= this.slowCallThreshold) {
      shouldOpen = true;
      reason = `slow call rate ${(metrics.slowCallRate * 100).toFixed(2)}% >= ${this.slowCallThreshold * 100}%`;
    }
    
    // 检查错误率
    if (metrics.errorRate >= this.errorThreshold) {
      shouldOpen = true;
      reason = `error rate ${(metrics.errorRate * 100).toFixed(2)}% >= ${this.errorThreshold * 100}%`;
    }

    if (shouldOpen) {
      console.warn(`[CircuitBreaker] ${this.resource} triggering OPEN: ${reason}`);
      this.transitionToOpen();
    }
  }

  async executeFallback(fallback) {
    if (fallback) {
      try {
        return await fallback();
      } catch (err) {
        return { error: 'FALLBACK_FAILED', message: err.message };
      }
    }
    return { 
      error: 'CIRCUIT_BREAKER_OPEN',
      message: '服务暂不可用，请稍后重试',
      retryAfter: Math.ceil(this.waitDurationInOpenState / 1000)
    };
  }

  getState() {
    return {
      resource: this.resource,
      state: this.state,
      metrics: this.metrics.getMetrics(),
      openTime: this.openTime
    };
  }

  destroy() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
  }
}

module.exports = { CircuitBreaker, State };