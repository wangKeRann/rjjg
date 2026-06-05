const technologyStack = [
  {
    group: "Security",
    name: "Spring Security",
    status: "architecture-ready",
    module: "spring-backend",
    feature: "用户登录认证、JWT 鉴权、用户端接口保护",
    demo: "查看 spring-backend/src/main/java/com/cinema/security/SpringSecurityConfig.java",
  },
  {
    group: "Security",
    name: "Shiro",
    status: "architecture-ready",
    module: "spring-backend",
    feature: "后台管理端角色、权限、菜单控制",
    demo: "查看 spring-backend/src/main/java/com/cinema/security/ShiroPermissionConfig.java",
  },
  {
    group: "Coordination",
    name: "ZooKeeper",
    status: "compose-ready",
    module: "docker-compose.yml",
    feature: "分布式节点协调、服务状态协同、Kafka/RabbitMQ 外部协调预留",
    demo: "docker compose up zookeeper",
  },
  {
    group: "AI Service",
    name: "Hybrid Flask",
    status: "service-ready",
    module: "services/flask-recommender",
    feature: "基于热度、评分、购票记录生成影片推荐",
    demo: "python services/flask-recommender/app.py",
  },
  {
    group: "Container",
    name: "Docker",
    status: "config-ready",
    module: "Dockerfile / docker-compose.yml",
    feature: "一键容器化部署前端、后端和中间件",
    demo: "docker compose up -d",
  },
  {
    group: "Database",
    name: "数据库读写分离",
    status: "architecture-ready",
    module: "spring-backend/config",
    feature: "写请求进入主库，读请求进入从库，降低查询压力",
    demo: "查看 DynamicDataSourceConfig.java",
  },
  {
    group: "Message",
    name: "MQ",
    status: "running",
    module: "src/redisStore.js",
    feature: "订单创建、支付、取消事件异步入队",
    demo: "/api/admin/stats 查看事件队列",
  },
  {
    group: "Gateway",
    name: "Nginx",
    status: "config-ready",
    module: "infra/nginx/nginx.conf",
    feature: "统一入口、静态资源代理、API 反向代理",
    demo: "docker compose up nginx",
  },
  {
    group: "Gateway",
    name: "负载均衡",
    status: "config-ready",
    module: "infra/nginx/nginx.conf",
    feature: "将流量分发到 cinema-web-a / cinema-web-b",
    demo: "Nginx upstream cinema_backend",
  },
  {
    group: "Search",
    name: "Elasticsearch",
    status: "api-ready",
    module: "src/server.js / docker-compose.yml",
    feature: "影片、影院、标签全文搜索；本地演示提供内存兜底搜索",
    demo: "/api/search?q=IMAX",
  },
  {
    group: "Frontend",
    name: "Vue",
    status: "running",
    module: "public/app.js",
    feature: "前端单页应用、筛选、购票交互、技术矩阵展示",
    demo: "http://localhost:3000",
  },
  {
    group: "Chart",
    name: "ECharts",
    status: "running",
    module: "public/app.js",
    feature: "座位销售统计、热度收入统计、技术覆盖雷达图",
    demo: "页面运行态看板",
  },
  {
    group: "Governance",
    name: "Sentinel",
    status: "compose-ready",
    module: "docker-compose.yml / spring-backend",
    feature: "接口限流、熔断、热点参数保护",
    demo: "docker compose up sentinel-dashboard",
  },
  {
    group: "Governance",
    name: "Nacos",
    status: "compose-ready",
    module: "docker-compose.yml / spring-backend",
    feature: "服务注册、配置中心、服务发现",
    demo: "docker compose up nacos",
  },
  {
    group: "Message",
    name: "RabbitMQ",
    status: "compose-ready",
    module: "docker-compose.yml / spring-backend",
    feature: "异步出票、支付通知、积分发放消息",
    demo: "http://localhost:15672",
  },
  {
    group: "Orchestration",
    name: "Kubernetes",
    status: "manifest-ready",
    module: "k8s",
    feature: "应用编排、滚动发布、服务发现、弹性扩容",
    demo: "kubectl apply -f k8s/",
  },
  {
    group: "Log",
    name: "Slf4j + logback",
    status: "architecture-ready",
    module: "spring-backend/src/main/resources/logback-spring.xml",
    feature: "Java 后端结构化日志、订单链路日志",
    demo: "查看 logback-spring.xml",
  },
  {
    group: "Test",
    name: "JUnit",
    status: "architecture-ready",
    module: "spring-backend/src/test",
    feature: "订单锁座、权限、搜索接口单元测试",
    demo: "spring-backend/src/test/java",
  },
  {
    group: "Cache",
    name: "Redis",
    status: "running",
    module: "src/redisStore.js",
    feature: "座位临时锁、事件队列、缓存兜底",
    demo: "/api/health 显示 redis",
  },
  {
    group: "Monitor",
    name: "Prometheus",
    status: "running",
    module: "src/server.js / infra/prometheus/prometheus.yml",
    feature: "HTTP 延迟、订单数、Redis 模式等指标采集",
    demo: "/metrics",
  },
];

function getTechnologyStack() {
  return technologyStack;
}

function getTechnologyCoverage() {
  const totals = technologyStack.reduce((acc, item) => {
    acc[item.group] = (acc[item.group] || 0) + 1;
    return acc;
  }, {});
  return Object.entries(totals).map(([group, count]) => ({ group, count }));
}

module.exports = {
  getTechnologyCoverage,
  getTechnologyStack,
};
