// src/sentinel/degradationManager.js
class DegradationManager {
  constructor(store, searchService, logger) {
    this.store = store;
    this.searchService = searchService;
    this.logger = logger;
    
    // 降级级别: 0-正常, 1-部分降级, 2-完全降级
    this.currentLevel = 0;
    
    // 降级策略配置
    this.strategies = {
      0: {
        name: 'NORMAL',
        enabled: true,
        vipSeatsEnabled: true,
        lockTtlSeconds: 120,
        searchEngine: 'elasticsearch',
        redisEnabled: true,
        maxOrdersPerUser: 5
      },
      1: {
        name: 'PARTIAL',
        enabled: true,
        vipSeatsEnabled: false,      // 禁用VIP座位
        lockTtlSeconds: 30,          // 减少锁定时长
        searchEngine: 'memory',      // 降级到内存搜索
        redisEnabled: true,
        maxOrdersPerUser: 2
      },
      2: {
        name: 'FULL',
        enabled: false,               // 禁止下单
        vipSeatsEnabled: false,
        lockTtlSeconds: 0,
        searchEngine: 'memory',
        redisEnabled: false,          // 只使用内存
        maxOrdersPerUser: 0
      }
    };
    
    // 监控指标
    this.metrics = {
      errorRate: 0,
      avgResponseTime: 0,
      redisHealth: true,
      lastUpdate: Date.now()
    };
    
    // 定期更新降级级别
    this.startMonitor();
  }

  startMonitor() {
    this.monitorInterval = setInterval(() => {
      this.updateDegradationLevel();
    }, 5000); // 每5秒检查一次
  }

  // 更新降级级别（基于系统指标）
  updateDegradationLevel() {
    const oldLevel = this.currentLevel;
    let newLevel = 0;
    
    // 检查 Redis 健康状态
    const redisHealthy = this.store && this.store.client && this.store.client.isOpen;
    
    // 检查错误率
    const highErrorRate = this.metrics.errorRate > 0.3;
    
    // 检查响应时间
    const highResponseTime = this.metrics.avgResponseTime > 2000;
    
    // 确定降级级别
    if (!redisHealthy || highErrorRate || highResponseTime) {
      newLevel = 2;
    } else if (this.metrics.errorRate > 0.1 || this.metrics.avgResponseTime > 1000) {
      newLevel = 1;
    } else {
      newLevel = 0;
    }
    
    if (oldLevel !== newLevel) {
      this.logger.warn({
        oldLevel: this.strategies[oldLevel]?.name,
        newLevel: this.strategies[newLevel]?.name,
        metrics: this.metrics
      }, '降级级别变更');
      this.currentLevel = newLevel;
    }
  }

  // 更新监控指标（由外部调用）
  updateMetrics(metrics) {
    this.metrics = { ...this.metrics, ...metrics, lastUpdate: Date.now() };
  }

  // 获取当前降级策略
  getCurrentStrategy() {
    return this.strategies[this.currentLevel];
  }

  // 下单接口降级处理
  async degradeCreateOrder(showId, seats, userId, originalFn) {
    const strategy = this.getCurrentStrategy();
    
    // 完全降级：拒绝所有下单请求
    if (!strategy.enabled) {
      this.logger.warn({ showId, userId }, 'Full degradation: order rejected');
      return {
        degraded: true,
        level: 2,
        error: 'SERVICE_BUSY',
        message: '系统繁忙，请稍后再试',
        estimatedWaitTime: 30000
      };
    }
    
    // 部分降级：检查VIP座位
    if (!strategy.vipSeatsEnabled) {
      const vipSeats = seats.filter(seat => 
        seat.toLowerCase().includes('vip') || 
        seat.includes('尊享') ||
        (seat.charCodeAt(0) >= 65 && seat.charCodeAt(0) <= 90 && parseInt(seat.substring(1)) <= 2)
      );
      
      if (vipSeats.length > 0) {
        this.logger.warn({ showId, userId, vipSeats }, 'VIP seats disabled in partial degradation');
        return {
          degraded: true,
          level: 1,
          error: 'VIP_TEMP_UNAVAILABLE',
          message: '当前服务繁忙，VIP座位暂不可用，请选择普通座位',
          availableSeats: seats.filter(s => !vipSeats.includes(s))
        };
      }
    }
    
    // 执行原函数，传入降级参数
    try {
      const result = await originalFn({
        ttlReduced: strategy.lockTtlSeconds !== 120,
        lockTtlSeconds: strategy.lockTtlSeconds,
        degraded: this.currentLevel > 0
      });
      
      return { ...result, degraded: this.currentLevel > 0, degradationLevel: this.currentLevel };
    } catch (error) {
      this.logger.error({ error: error.message, showId, userId }, 'Order creation failed in degradation');
      throw error;
    }
  }

  // 搜索接口降级
  async degradeSearch(query, limit, originalFn) {
    const strategy = this.getCurrentStrategy();
    
    if (strategy.searchEngine === 'memory' && this.searchService) {
      this.logger.debug({ query }, 'Search degraded to memory');
      // 使用内存搜索
      const { getMovies, getCinemas } = require('../catalog');
      const movies = getMovies();
      const cinemas = getCinemas();
      return this.searchService.searchInMemory(query, { limit }, movies, cinemas);
    }
    
    return await originalFn();
  }

  // 缓存降级
  async degradeCache(type, identifier, originalFn) {
    const strategy = this.getCurrentStrategy();
    
    // 完全降级：只使用内存缓存
    if (!strategy.redisEnabled && this.store) {
      this.logger.debug({ type, identifier }, 'Cache degraded to memory only');
      const memoryValue = this.store.getMemoryCache(this.store.cacheKey(type, identifier));
      if (memoryValue) {
        try {
          const parsed = JSON.parse(memoryValue);
          return parsed.data;
        } catch (e) {
          return null;
        }
      }
      return null;
    }
    
    return await originalFn();
  }

  // 获取降级状态
  getStatus() {
    return {
      level: this.currentLevel,
      strategy: this.getCurrentStrategy().name,
      metrics: this.metrics,
      strategies: Object.keys(this.strategies).map(k => ({
        level: parseInt(k),
        name: this.strategies[k].name,
        enabled: this.strategies[k].enabled
      }))
    };
  }

  destroy() {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
    }
  }
}

module.exports = { DegradationManager };