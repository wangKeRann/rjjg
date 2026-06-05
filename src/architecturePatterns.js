const architecturePatterns = [
  {
    name: "BFF",
    fullName: "Backend for Frontend",
    scenario: "用户端和管理员端页面信息密度不同",
    design: "为用户端聚合影片、影院、座位；为管理员端聚合订单、权限、监控和技术矩阵。",
  },
  {
    name: "CQRS",
    fullName: "Command Query Responsibility Segregation",
    scenario: "购票写操作和影片/报表查询压力差异明显",
    design: "下单、支付作为命令链路；影片、影院、统计、搜索作为查询链路，并配合读写分离。",
  },
  {
    name: "Outbox",
    fullName: "Transactional Outbox",
    scenario: "订单支付成功后需要可靠发送出票、积分、通知事件",
    design: "订单状态变更和待发送事件先落库，后台任务再投递到 RabbitMQ，避免业务成功但消息丢失。",
  },
  {
    name: "Idempotency",
    fullName: "幂等设计",
    scenario: "用户重复点击支付或网络重试",
    design: "支付确认使用 orderId + paymentRequestId 作为幂等键，同一订单只允许从待支付变为已支付一次。",
  },
  {
    name: "Circuit Breaker",
    fullName: "熔断降级",
    scenario: "推荐服务、搜索服务或支付模拟服务异常",
    design: "Sentinel 对外部依赖设置熔断规则，失败时返回缓存推荐或基础搜索结果。",
  },
  {
    name: "Bulkhead",
    fullName: "舱壁隔离",
    scenario: "后台报表查询慢，不能拖垮用户购票",
    design: "用户端、管理端、搜索、推荐使用不同线程池和限流规则，避免故障扩散。",
  },
  {
    name: "Cache Aside",
    fullName: "旁路缓存",
    scenario: "热门影片和热门场次访问频繁",
    design: "先查 Redis 缓存，未命中再查数据库或搜索服务，写操作后失效相关缓存。",
  },
  {
    name: "Blue Green",
    fullName: "蓝绿/灰度发布",
    scenario: "答辩演示或生产发布新页面时不能中断购票",
    design: "Kubernetes 保留两个版本 Deployment，Nginx 或 Ingress 调整流量权重完成平滑切换。",
  },
];

function getArchitecturePatterns() {
  return architecturePatterns;
}

module.exports = {
  getArchitecturePatterns,
};
