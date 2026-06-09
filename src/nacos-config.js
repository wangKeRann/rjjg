// src/nacos-config.js 不变
class NacosConfigSimulator {
  constructor() {
    this.config = {
      priceRate: 1.0,   // 新增：票价整体倍率（核心作用于调价）
      globalDiscount: 1.0,
      vipExtraDiscount: 0.9,
      maxTicketLimit: 4
    };
    this.listeners = [];
  }

  getConfig() {
    return this.config;
  }

  publishConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    console.log(`[Nacos] 配置已更新:`, this.config);
    this.listeners.forEach(listener => listener(this.config));
  }

  subscribe(listener) {
    this.listeners.push(listener);
  }
}
module.exports = new NacosConfigSimulator();