# 影院订票系统 — 汇报 PPT 大纲（按 7 人分工 + 代码实现）

---

## Slide 1：封面
- 项目名称：影院订票系统
- 软件架构课程期末项目 · 7 人协作

---

## Slide 2：项目总览
- **用户端**：登录 → 浏览影片 → 搜索 → 选座 → 下单 → 支付
- **管理员端**：登录 → 查看仪表盘 → 调价 → 销售统计图表 → 运维监控
- **技术覆盖面**：20 项课程要求技术全部落地

---

## Slide 3：系统架构拓扑图
```
Nginx (least_conn 负载均衡, infra/nginx/nginx.conf)
 ├── cinema-web-a (Docker, Dockerfile)
 └── cinema-web-b (Docker, Dockerfile)
      ├── Redis — 缓存/锁座/事件队列 (src/redisStore.js)
      ├── ZooKeeper — 分布式锁协调 (src/redisStore.js:85-176)
      ├── Elasticsearch — 全文搜索 + 内存降级 (src/searchService.js)
      ├── RabbitMQ — Topic 交换机异步消息 (src/rabbitmqClient.js)
      ├── Outbox — 事件先落盘再投递 (src/outboxService.js)
      ├── Sentinel — 限流/熔断/三级降级 (src/sentinel/)
      ├── Nacos — 配置中心模拟 (src/nacos-config.js)
      ├── Prometheus — 6 个自定义指标 (src/server.js:79-116)
      ├── OpenTelemetry — NodeSDK + OTLP (src/tracing.js)
      ├── Winston — Slf4j/logback 风格日志 (src/logger.js)
      ├── 读写分离 — 主库写 + 从库读 (src/db-rw-separation.js)
      └── Spring Backend — 安全/读写分离骨架 (spring-backend/)
```

---

## Slide 4-5：成员 A — 登录与门户页
### 负责技术：Spring Security + Shiro + JWT/RBAC

> **技术简介**
>
> **JWT（JSON Web Token）**：一种无状态的令牌认证机制。用户登录后服务端签发一个包含用户身份和权限的 JSON 令牌，后续请求携带此令牌即可通过验证，无需服务端维护会话。本项目使用 HS256 算法签名、8 小时过期、吊销黑名单机制。
>
> **Spring Security**：Java 生态最主流的安全框架，提供认证（Authentication）和授权（Authorization）两大核心能力。本项目参照其"过滤器链"思想，在 Node.js 中用中间件链实现相同的逐层拦截效果。
>
> **Shiro**：Apache 出品的轻量级安全框架，核心是角色（Role）→ 权限（Permission）的细粒度控制。本项目借鉴 Shiro 的 RBAC 模型，定义 `CUSTOMER` 和 `ADMIN` 两个角色，每个角色挂载不同权限点（如 `order:pay:self`、`show:price:update`）。

### 实际代码实现

**1. JWT 认证（Spring Security 思想）** — `src/auth.js`

```js
// HS256 签名，8 小时过期，吊销黑名单
function signJwt(payload) {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = createSignature(`${encodedHeader}.${encodedPayload}`);
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function verifyJwt(token) {
  // 校验签名 → 校验过期 → 校验吊销列表
  if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
  if (revokedTokenIds.has(payload.jti)) return null;
  return payload;
}
```
- 密码哈希 + `timingSafeEqual` 防时序攻击
- 退出登录写入吊销黑名单，定时清理过期 token

**2. RBAC 权限模型（Shiro 思想）** — `src/auth.js:8-28`

```js
const ROLE_PERMISSIONS = Object.freeze({
  CUSTOMER: ["movie:read", "show:read", "order:create",
              "order:read:self", "order:pay:self", "order:cancel:self"],
  ADMIN:    ["movie:read", "show:read", "admin:dashboard",
              "show:price:update", "order:read:any", "order:pay:any",
              "order:cancel:any", "cache:manage", "ops:view"],
});
```

**3. 中间件权限拦截** — `src/auth.js:101-134`

```js
function requirePermission(...permissions) {
  return requireAuth({ permissions: permissions.flat() });
}
// 使用示例：
app.post("/api/orders/:orderId/pay",
  requirePermission("order:pay:self", "order:pay:any"), handler);
```

**4. 前端登录页** — `public/js/pages/login.js`
- 猫猫视觉 UI（瞳孔跟踪鼠标）
- 自动角色识别 → 跳转不同页面

### 对应代码文件
| 文件 | 作用 |
|------|------|
| `src/auth.js` | JWT 签发/校验、RBAC 权限、中间件链 |
| `public/login.html` | 登录页 UI |
| `public/js/pages/login.js` | 登录请求 + 角色跳转 |
| `spring-backend/.../SpringSecurityConfig.java` | Spring Security 设计骨架 |
| `spring-backend/.../ShiroPermissionConfig.java` | Shiro 权限设计骨架 |

---

## Slide 6-7：成员 B — 影片与影院浏览页
### 负责技术：Elasticsearch + Redis + Nginx

> **技术简介**
>
> **Elasticsearch**：基于 Lucene 的分布式全文搜索引擎，支持倒排索引、多字段权重、模糊匹配、中文分词。本项目用它实现影片名称、标签、导演、演员的模糊搜索，并按热度/评分排序返回。ES 不可用时自动降级到内存搜索。
>
> **Redis**：高性能内存键值数据库，常用作缓存层。本项目用它实现 Cache Aside 缓存策略——先查 Redis，未命中再查数据库，写操作后失效相关缓存。热点数据（影片列表、搜索结果）缓存 5-10 分钟，减少数据库查询压力。
>
> **Nginx**：高性能 HTTP 服务器和反向代理。本项目将其部署在两个 Web 实例前面，使用 `least_conn` 算法将请求分发给连接数最少的实例，实现负载均衡。同时负责静态资源代理和 API 反向代理。

### 实际代码实现

**1. Elasticsearch 全文搜索** — `src/searchService.js`

```js
class SearchService {
  async connect() {
    this.client = new Client({ node: 'http://localhost:9200' });
    await this.client.ping();
    this.mode = 'elasticsearch';
    await this.createIndices();  // 自动创建 movies / cinemas 索引
  }

  async searchMovies(query) {
    // 多字段权重搜索：title^3, tags^2, genre, director, cast...
    return this.client.search({
      index: 'movies',
      body: { query: { multi_match: { query, fields: [...], fuzziness: 'AUTO' } } }
    });
  }
}
```
- ES 不可用时自动降级到内存 `includes()` 搜索（`searchInMemory`）
- 自动重连 + 定期健康检查

**2. Redis 缓存策略（Cache Aside）** — `src/redisStore.js:401-484`

```js
async getCache(type, identifier) {
  // 1. 先查 Redis
  cachedValue = await this.client.get(key);
  // 2. Redis 未命中 → 查内存二级缓存
  if (!cachedValue) cachedValue = this.getMemoryCache(key);
  // 3. 都没命中 → 返回 null，调用方查数据库
  return parsed.data;
}
```
- 影片列表、影院列表、搜索结果、热门影片 四种缓存
- TTL：默认 5 分钟，热门搜索词 10 分钟

**3. Nginx 反向代理 + 负载均衡** — `infra/nginx/nginx.conf`

```nginx
upstream cinema_backend {
  least_conn;                    # 最小连接数算法
  server cinema-web-a:3000;
  server cinema-web-b:3000;
}
server {
  listen 80;
  location / { proxy_pass http://cinema_backend; }
  location /api/ { proxy_pass http://cinema_backend; }
}
```

**4. 前端影片浏览页** — `public/js/pages/movies.js`
- Vue 3 响应式：热度/评分/价格排序，300ms 防抖搜索
- 显示缓存命中状态标志

### 对应代码文件
| 文件 | 作用 |
|------|------|
| `src/searchService.js` | ES 连接/索引/搜索 + 内存降级 |
| `src/redisStore.js` | Redis 缓存读写 + 内存二级缓存 |
| `infra/nginx/nginx.conf` | Nginx least_conn 负载均衡 |
| `public/movies.html` | 影片浏览页 UI |
| `public/js/pages/movies.js` | 搜索/排序/缓存状态展示 |

---

## Slide 8-9：成员 C — 场次与选座购票页
### 负责技术：Redis + Sentinel + ZooKeeper

> **技术简介**
>
> **Redis 分布式锁**：利用 `SET key value NX EX ttl` 原子命令实现互斥锁——NX 保证仅当 key 不存在时才写入，EX 设置过期时间防止死锁。本项目用于购票时临时锁定座位（120s TTL），防止多个用户同时购买同一座位造成超卖。支付成功释放锁并标记已售，超时自动释放回池。
>
> **Sentinel**：阿里巴巴开源的流量治理组件，提供流量控制、熔断降级、热点参数保护三大能力。本项目完整实现了三级保护链：①限流（令牌桶全局限流 + 用户级限流，防止刷单）→ ②熔断（滑动窗口统计慢调用率和错误率，触发后执行 fallback，60s 后半开探测恢复）→ ③降级（三级策略：正常/部分降级/完全降级，自动检测系统指标切换）。
>
> **ZooKeeper**：分布式协调服务，通过临时节点（EPHEMERAL）实现分布式锁——客户端断开连接时节点自动删除，避免死锁。本项目用 ZK 做第二重全局锁，与 Redis 锁形成双保险。ZK 不可用时自动降级到纯 Redis 锁。

### 实际代码实现

**1. Redis 分布式锁座（防超卖）** — `src/redisStore.js:284-336`

```js
async lockSeat(showId, seat, orderId, ttlSeconds) {
  // 1. ZooKeeper 临时节点做全局锁
  await this.ensurePathExists(`/locks/seat/${showId}`);
  this.zkClient.create(zkPath, Buffer.from(orderId), EPHEMERAL, ...);
  // 2. Redis SET NX EX 原子锁
  const result = await this.client.set(key, orderId, { NX: true, EX: ttlSeconds });
  return result === "OK";
}
```
- 下单成功锁座 120s，支付后释放锁 + 标记已售
- 超时自动释放；Redis 不可用 → 内存 Map 降级

**2. ZooKeeper 分布式协调** — `src/redisStore.js:85-176`

```js
async acquireGlobalLock(lockName, ttl = 5000) {
  this.zkClient.create(`/locks/${lockName}`, Buffer.from("locked"),
    zookeeper.CreateMode.EPHEMERAL, (error) => {
      if (error?.getCode() === zookeeper.Exception.NODE_EXISTS)
        return resolve(false); // 已被锁
      resolve(true);
    });
}
```
- ZK 不可用时自动降级到纯 Redis 锁

**3. Sentinel 全链路保护（限流 → 熔断 → 降级）** — `src/sentinel/index.js:151-183`

```js
async protect(resource, param, userId, fn, fallback) {
  // Step 1: 降级级别检查（Level 2 直接拒绝下单）
  if (!strategy.enabled) return { error: 'SERVICE_DEGRADED' };
  // Step 2: 限流检查（令牌桶 + 用户级限流）
  const rateLimitResult = await this.withRateLimit(resource, param, userId);
  // Step 3: 熔断保护（滑动窗口 → OPEN → HALF_OPEN → CLOSED）
  return await this.withCircuitBreaker(`${resource}:${param}`, fn, fallback);
}
```

**4. 熔断器实现** — `src/sentinel/circuitBreaker.js`

```js
class CircuitBreaker {
  // 滑动窗口统计：慢调用率 ≥ 50% 或 错误率 ≥ 30% → 触发熔断
  checkCircuitBreaker() {
    if (metrics.slowCallRate >= 0.5 || metrics.errorRate >= 0.3) {
      this.transitionToOpen();  // → OPEN，执行 fallback
      setTimeout(() => this.transitionToHalfOpen(), 60000); // 60s 后探测
    }
  }
}
```

**5. 三级降级** — `src/sentinel/degradationManager.js:12-40`

```js
strategies = {
  0: { name:'NORMAL',  enabled:true,  vipSeatsEnabled:true,  lockTtlSeconds:120 },
  1: { name:'PARTIAL', enabled:true,  vipSeatsEnabled:false, lockTtlSeconds:30 },
  2: { name:'FULL',    enabled:false, vipSeatsEnabled:false, lockTtlSeconds:0 },
};
```

**6. 前端选座页** — `public/js/pages/booking.js`
- 座位图渲染，锁座倒计时显示
- 下单和支付两步流程

### 对应代码文件
| 文件 | 作用 |
|------|------|
| `src/redisStore.js` | Redis 锁座 + ZK 协调 + 内存降级 |
| `src/sentinel/index.js` | Sentinel 统一入口 |
| `src/sentinel/circuitBreaker.js` | 熔断器（滑动窗口） |
| `src/sentinel/rateLimiter.js` | 令牌桶/漏桶限流 |
| `src/sentinel/degradationManager.js` | 三级降级策略 |
| `public/booking.html` | 选座购票页 UI |
| `public/js/pages/booking.js` | 选座/下单/支付交互 |

---

Slide 10-11：成员 D — 订单与支付页
负责技术：RabbitMQ + Outbox Pattern + Winston 结构化日志


【技术简介】

RabbitMQ：基于 AMQP 协议的消息中间件。本项目使用 Topic 交换机 order_events，将订单创建、支付、取消事件路由到 3 个持久队列，实现业务解耦和异步处理。

Transactional Outbox 模式：解决"数据库写入成功但消息发送失败"的一致性问题。订单状态变更和事件记录在同一事务中先落盘，后台再异步投递到 RabbitMQ，投递成功标记 sent，失败则标记 failed 并重试，确保不丢消息。

Winston 结构化日志：JSON 格式输出、按级别分文件（combined/error/orders）、滚动归档、订单全生命周期日志追踪。


【核心流程】

用户支付请求
    ↓
① 更新订单状态 + 创建 Outbox 事件（同步落盘 outbox.json）
    ↓
② 尝试发送到 RabbitMQ
    ├── 成功 → 标记 sent，消费者处理（统计/通知）
    └── 失败 → 标记 failed，等待重试
    ↓
③ 后台定时脚本扫描 pending/failed 事件并重发


【关键代码实现】

1. RabbitMQ 客户端 — src/rabbitmqClient.js

// 声明交换机、队列并绑定
await channel.assertExchange('order_events', 'topic', { durable: true });
await channel.assertQueue('order_paid_queue', { durable: true });
await channel.bindQueue('order_paid_queue', 'order_events', 'order.paid');

// 发布事件（持久化）
channel.publish(exchange, routingKey, message, { persistent: true });

// 连接断开后自动重连（5秒间隔）
connection.on('close', () => setTimeout(connectRabbitMQ, 5000));


2. Outbox 服务 — src/outboxService.js

// 创建事件（同步落盘）
function createOutboxEvent(eventType, aggregateId, payload) {
  const event = {
    id: uuid(),
    eventType,        // ORDER_CREATED / PAID / CANCELLED
    aggregateId,
    payload,
    status: 'pending',   // pending → sent / failed
    retryCount: 0,
    maxRetries: 3,
  };
  outbox.events.push(event);
  fs.writeFileSync(OUTBOX_FILE, JSON.stringify(outbox));
  return event;
}

// 获取待发送事件
function getPendingEvents() {
  return outbox.events.filter(e => e.status === 'pending' && e.retryCount < 3);
}


3. 订单服务集成 — src/orderService.js

async function payOrder(orderId) {
  // 更新订单状态
  const paidOrder = updateOrder(order.id, row => { row.status = 'PAID'; });
  // 记录日志 + 发送事件（自动创建 Outbox 记录）
  orderLogger.paid(paidOrder);
  await sendOrderEvent('ORDER_PAID', paidOrder);
  return paidOrder;
}


4. Winston 结构化日志 — src/logger.js

const logger = winston.createLogger({
  format: winston.format.json(),
  transports: [
    new File({ filename: 'combined.log', maxsize: '10m', maxFiles: 5 }),
    new File({ filename: 'error.log', level: 'error' }),
    new File({ filename: 'orders.log' }),  // 订单专用
  ],
});

const orderLogger = {
  created(order) { logger.info(`[ORDER_CREATED] ${order.id}`, { orderId, amount }); },
  paid(order)    { logger.info(`[ORDER_PAID] ${order.id}`, { orderId, paidAt }); },
  cancelled(order, reason) { logger.warn(`[ORDER_CANCELLED] ${order.id}`, { reason }); },
};


5. 后台重试脚本 — scripts/processOutbox.js

// 每10秒扫描并重发 pending 事件
setInterval(async () => {
  const pendingEvents = getPendingEvents();
  for (const event of pendingEvents) {
    const ok = await publishEvent(routingKey, event.payload);
    ok ? markEventAsSent(event.id) : markEventAsFailed(event.id);
  }
}, 10000);


6. 前端订单页 — orders.js

async pay(order) {
  if (new Date(order.expiresAt) <= new Date()) {
    await this.cancelExpiredOrder(order);
    return;
  }
  const res = await fetch(`/api/orders/${order.id}/pay`, { method: 'POST' });
  if (res.ok) this.loadOrders();  // 刷新列表
}


【日志输出示例】

{"level":"info","message":"[ORDER_CREATED] f18ab08b...","orderId":"f18ab08b...","userId":"u1002","amount":58}
{"level":"info","message":"[ORDER_PAID] f18ab08b...","paidAt":"2026-06-10T07:45:46.807Z"}
{"level":"warn","message":"RabbitMQ 未连接，事件将仅保存在 Outbox 中"}


【文件清单】

src/rabbitmqClient.js      RabbitMQ 连接、发布、自动重连
src/outboxService.js       Outbox 事件创建、状态管理、清理
src/orderService.js        订单业务逻辑（创建/支付/取消）
src/logger.js              Winston JSON 日志
server-standalone.js       订单 API（/pay, /cancel, /orders）
public/orders.html         订单页 UI
public/js/pages/orders.js  订单页交互
scripts/processOutbox.js   Outbox 后台重试脚本


【关键设计亮点】

1. 最终一致性：Outbox 模式保证订单变更与消息投递不丢失
2. 高可用：RabbitMQ 持久化 + 自动重连 + 消息确认
3. 可观测性：Winston JSON 日志 + 按业务分文件 + 滚动归档
4. 优雅降级：MQ 不可用时事件暂存 Outbox，恢复后自动重发
5. 用户体验：前端倒计时 + 自动刷新 + 超时自动取消

---

## Slide 12-13：成员 E — 管理员场次调价页
### 负责技术：数据库读写分离 + Nacos + JUnit(node --test)

> **技术简介**
>
> **数据库读写分离**：大型系统中，写操作（INSERT/UPDATE/DELETE）走主库，读操作（SELECT）走从库，主库数据通过主从复制同步到从库。本项目用两个 JSON 文件模拟：`cinema-db.json` 为主库（写），`cinema-db-slave.json` 为从库（读），写操作后 5s 异步同步模拟主从延迟。
>
> **Nacos**：阿里巴巴开源的服务发现和配置中心。本项目模拟其配置管理能力——管理员调价时 Nacos 发布新的 `priceRate`，所有订阅者（影片列表接口）实时收到推送，用户端立即看到新票价，无需重启服务。
>
> **JUnit**：Java 标准单元测试框架。本项目使用 Node.js 内置的 `node:test` 模块（等效 JUnit），编写 6 个集成测试用例覆盖登录/RBAC/下单/锁座/支付/调价/搜索/缓存全链路，确保核心功能可用。

### 实际代码实现

**1. 数据库读写分离** — `src/db-rw-separation.js`

```js
// 读从库
function readDatabase() {
  return safeRead(SLAVE_FILE);  // cinema-db-slave.json
}
// 写主库，异步同步到从库（模拟 5s 主从延迟）
function updateDatabase(updater) {
  const db = safeRead(MASTER_FILE);  // cinema-db.json
  updater(db);
  fs.writeFileSync(MASTER_FILE, JSON.stringify(db));
  setTimeout(() => {
    fs.writeFileSync(SLAVE_FILE, JSON.stringify(db));  // 5s 后同步
  }, 5000);
  return db;
}
```
- 调价接口 `PATCH /api/admin/shows/:showId/price` 写主库后读从库返回

**2. Nacos 配置中心模拟** — `src/nacos-config.js`

```js
class NacosConfigSimulator {
  config = { priceRate: 1.0, globalDiscount: 1.0, vipExtraDiscount: 0.9 };
  publishConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    this.listeners.forEach(listener => listener(this.config)); // 推送变更
  }
  subscribe(listener) { this.listeners.push(listener); }
}
```
- 票价倍率实时生效，影片列表接口自动应用 `priceRate`

**3. JUnit 测试（node --test）** — `test/api.test.js`

```js
test("admin can view dashboard and update show price", async () => {
  const adminToken = await login(server, "admin", "admin", "admin123");
  const dashboard = await request(server, "/api/admin/dashboard", { headers });
  assert.equal(dashboard.response.status, 200);
  // 调价
  const updated = await request(server, `/api/admin/shows/${show.id}/price`, {
    method: "PATCH", headers, body: JSON.stringify({ price: show.price + 3 }),
  });
  assert.equal(updated.body.show.price, show.price + 3);
});
```
- 6 个测试用例覆盖：登录/RBAC/下单/锁座/支付/调价/搜索/缓存

**4. 前端调价页** — `public/js/pages/admin-shows.js`
- 从库加载场次数据，修改票价后写主库
- Nacos 倍率滑块实时调整

### 对应代码文件
| 文件 | 作用 |
|------|------|
| `src/db-rw-separation.js` | 主库写 + 从库读 + 延迟同步 |
| `src/nacos-config.js` | 配置中心 publish/subscribe |
| `test/api.test.js` | 6 个自动化测试用例 |
| `public/admin-shows.html` | 管理员调价页 UI |
| `public/js/pages/admin-shows.js` | 调价 + Nacos 配置交互 |
| `spring-backend/.../DynamicDataSourceConfig.java` | 读写分离 Spring 骨架 |

---


## Slide 14-15：成员 F — 管理员销售统计页
### 负责技术：ECharts + Prometheus + RabbitMQ / Redis 事件流

> **技术简介**
>
> **ECharts**：Apache 开源的 JavaScript 图表库，支持柱状图、折线图、饼图、雷达图等丰富图表类型。本项目使用 ECharts 渲染销售统计双图表——已售/可售堆叠柱状图对比各影片售票情况，独立柱状图展示各影片收入排行，支持窗口缩放自适应。
>
> **Prometheus**：云原生时代的标准监控体系，基于 Pull 模型定时抓取 `/metrics` 端点。本项目使用 prom-client 定义多类自定义指标，包含 Histogram 型 HTTP 延迟分布、Counter 型订单创建/支付计数、Gauge 型 Redis / Elasticsearch 模式状态、Counter 型缓存命中/未命中计数、Gauge 型内存缓存大小等，配置5s采集间隔，对接 Grafana 完成指标可视化展示。
>
> **RabbitMQ / Redis 事件流**：基于 RabbitMQ Topic Exchange 搭建事件总线，`stats_queue` 绑定 `order.*`、`price.updated` 两类路由键，汇聚订单创建、支付、取消与场次调价全量业务事件。统计页面事件展示依赖该事件队列，销售统计数值并非消费队列更新，而是实时聚合库表数据；当 RabbitMQ 服务不可用时，自动降级使用 Redis List 或内存事件队列缓存业务事件，保证页面事件流正常展示。

### 实际代码实现

**1. ECharts 销售图表** — `public/js/pages/admin-sales.js`

```js
renderCharts() {
  const movies = this.stats.movies || [];
  this.salesChart.setOption({
    series: [
      {
        name: "已售",
        type: "bar",
        stack: "seat",
        data: movies.map((movie) => movie.soldSeats),
        itemStyle: { color: "#ff6f91" },
      },
      {
        name: "可售",
        type: "bar",
        stack: "seat",
        data: movies.map((movie) => movie.availableSeats),
        itemStyle: { color: "#62f5ff" },
      },
    ],
  });
  this.heatChart.setOption({
    series: [
      {
        name: "收入",
        type: "bar",
        data: movies.map((movie) => movie.revenue),
        itemStyle: { color: "#ffd166" },
      },
    ],
  });
}
```
- 双图表组合：已售/可售堆叠柱状图 + 影片收入独立柱状图
- 图表数据来源：后端 `GET /api/admin/stats` 接口返回 movies 数组
- 自适应能力：浏览器窗口缩放自动重绘调整图表尺寸

**2. Prometheus 指标采集** — `src/server.js`

```js
const httpDuration = new promClient.Histogram({
  name: "cinema_http_request_duration_seconds",
  labelNames: ["method", "route", "status"],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2],
});
const ordersCreated = new promClient.Counter({
  name: "cinema_orders_created_total",
});
const ordersPaid = new promClient.Counter({
  name: "cinema_orders_paid_total",
});
const redisModeGauge = new promClient.Gauge({
  name: "cinema_redis_mode",
});
const elasticsearchModeGauge = new promClient.Gauge({
  name: "cinema_elasticsearch_mode",
});
const cacheHits = new promClient.Counter({
  name: "cinema_cache_hits_total",
  labelNames: ["type"],
});
const cacheMisses = new promClient.Counter({
  name: "cinema_cache_misses_total",
  labelNames: ["type"],
});
const cacheSizeGauge = new promClient.Gauge({
  name: "cinema_cache_memory_size",
});
```
- 服务暴露 `/metrics` 指标端点，供 Prometheus 定时拉取
- 配置文件 `infra/prometheus/prometheus.yml` 设置5秒采集间隔
- 指标覆盖：HTTP请求性能、订单业务量、中间件运行状态、缓存命中率、内存缓存容量

**3. RabbitMQ 统计事件流** — `src/rabbitmqClient.js`

```js
// 将事件队列绑定订单全量事件、价格更新事件路由
await channel.bindQueue(queueName, EXCHANGE_NAME, "order.*");
await channel.bindQueue(queueName, EXCHANGE_NAME, ROUTING_KEYS.PRICE_UPDATED);
```
- `stats_queue` 统一接收订单创建/支付/取消、场次调价事件
- 降级策略：RabbitMQ 故障时切换 Redis List / 内存队列存储事件
- 页面仅读取队列展示销售动态，统计营收数据不依赖事件队列计算

**4. 统计 API** — `src/server.js`
- 接口地址：`GET /api/admin/stats`
- 返回核心字段：各影片售票与营收数据、上座率、近期事件流、待支付/已支付订单数、影院总营收、Redis运行模式
- 数据逻辑：后端实时聚合订单、影片、场次库表数据生成统计结果
- 前端交互：页面刷新或点击刷新按钮，重新请求接口拉取最新统计数据

### 对应代码文件
| 文件 | 作用 |
|------|------|
| `public/admin-sales.html` | 销售统计页前端UI，包含指标卡片、图表容器、订单列表、事件流展示区域 |
| `public/js/pages/admin-sales.js` | 请求统计接口，完成ECharts双图表、订单列表、事件流渲染 |
| `src/server.js` | 定义Prometheus全量监控指标、暴露`/metrics`端点、实现`/api/admin/stats`统计接口 |
| `infra/prometheus/prometheus.yml` | Prometheus服务抓取配置，设置5s指标采集间隔 |
| `src/rabbitmqClient.js` | 初始化Topic交换机，完成`stats_queue`事件路由绑定 |
| Redis List / 内存队列 | RabbitMQ不可用时，事件流缓存降级方案 |

### 功能总结
成员 F 开发的管理员销售统计页面，整合数据可视化、全链路监控、实时业务事件三大能力。
1. 基于 ECharts 可视化各影片已售、可售座位对比及票房收入排行；
2. 通过统计接口聚合影院总营收、订单总量、影片上座率核心经营数据；
3. 接入 Prometheus 采集HTTP、订单、缓存、中间件运行监控指标；
4. 依托 RabbitMQ 事件总线展示实时销售动态，配套 Redis/内存队列降级保障可用性；
最终实现管理员单页面一站式查看影院票房、售票情况、订单状态与实时销售事件。


## Slide 16-17：成员 G — 运维监控页
### 负责技术：Docker/Kubernetes + Nginx/负载均衡 + Grafana/OpenTelemetry

> **技术简介**
>
> **Docker**：容器化平台，通过 Dockerfile 将应用及其依赖打包成镜像，实现"一次构建，到处运行"。本项目用 `node:20-alpine` 轻量基础镜像，多阶段优化（`npm ci --omit=dev` 排除开发依赖），`docker-compose.yml` 一键编排 9 个服务。
>
> **Kubernetes（K8s）**：容器编排平台，负责应用的自动部署、伸缩和管理。本项目配置了 Deployment（RollingUpdate 零停机更新）、Service（ClusterIP 内部发现）、Ingress（外部访问）、HPA（CPU 70% 触发 2→6 自动伸缩）、ConfigMap（统一配置）、livenessProbe 和 readinessProbe 健康检查。
>
> **OpenTelemetry**：云原生可观测性标准，统一了 Traces、Metrics、Logs 三大支柱。本项目用 Node SDK + 自动插桩 + OTLP Exporter 将 Trace 数据发送到 Collector → Jaeger，运维页面可查看最近 100 条 Span 的端到端调用链路和延迟分布。

### 实际代码实现

**1. Docker 容器化** — `Dockerfile` + `docker-compose.yml`

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY public ./public
COPY src ./src
EXPOSE 3000
CMD ["node", "src/server.js"]
```
- `docker-compose.yml`：9 个服务编排（2 个 Web 实例 + Redis + ZK + RabbitMQ + Nginx + Sentinel Dashboard）

**2. Kubernetes 部署** — `k8s/cinema-app.yaml`

```yaml
spec:
  replicas: 2
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0    # 零停机
      maxSurge: 1
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
spec:
  minReplicas: 2
  maxReplicas: 6
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          averageUtilization: 70   # CPU 70% 触发扩容
```
- Deployment + Service(ClusterIP) + Ingress + HPA
- ConfigMap 统一配置（`k8s/configmap.yaml`）
- 中间件独立部署（`k8s/middleware.yaml`：Redis, ES, Jaeger, OTEL Collector）

**3. OpenTelemetry 链路追踪** — `src/tracing.js`

```js
const sdk = new NodeSDK({
  resource: new Resource({ [ATTR_SERVICE_NAME]: "cinema-web" }),
  traceExporter: new OTLPTraceExporter({
    url: `${otlpEndpoint}/v1/traces`
  }),
  instrumentations: [getNodeAutoInstrumentations()],  // 自动插桩
});
```
- 自定义 Span 记录：`POST /api/orders`、`GET /api/search` 等
- 最近 100 条 Span 可视化展示（`/api/ops/observability`）
- OTEL Collector → Jaeger（`k8s/middleware.yaml` 中配置）

**4. 运维监控页** — `public/js/pages/ops.js`
- 6 个健康指标（Node/Redis/ES/Prometheus/OTel/MQ）
- Docker 容器拓扑 + K8s 部署信息
- Nginx 流量统计 + 上游服务器状态
- 最近 20 条 Trace Span + 系统事件合并展示

**5. 基础设施配置**
| 文件 | 作用 |
|------|------|
| `infra/otel-collector/otel-collector-config.yaml` | OTel Collector 配置 |
| `infra/prometheus/prometheus.yml` | 多 job 抓取 |
| `infra/nginx/nginx.conf` | 反向代理 + 负载均衡 |
| `k8s/namespace.yaml` | K8s 命名空间 |
| `k8s/deploy.sh` / `k8s/deploy.bat` | 一键部署脚本 |

### 对应代码文件
| 文件 | 作用 |
|------|------|
| `Dockerfile` | 应用镜像构建 |
| `docker-compose.yml` | 9 服务编排 |
| `k8s/cinema-app.yaml` | K8s Deployment + HPA |
| `k8s/middleware.yaml` | 中间件 K8s 部署 |
| `k8s/configmap.yaml` | 统一配置 |
| `infra/nginx/nginx.conf` | Nginx 负载均衡 |
| `infra/prometheus/prometheus.yml` | 指标抓取配置 |
| `infra/otel-collector/otel-collector-config.yaml` | OTel 管道配置 |
| `src/tracing.js` | OpenTelemetry SDK 初始化 |
| `public/ops.html` | 运维监控页 UI |
| `public/js/pages/ops.js` | 健康/拓扑/事件展示 |

---

## Slide 18：公共基础组件（供参考）
| 组件 | 文件 | 技术点 |
|------|------|--------|
| 前端公共工具 | `public/js/common.js` | JWT token 管理、`apiFetch` 封装、角色路由 |
| 全站样式 | `public/styles.css` | 玻璃拟态、暗色科技风、响应式 |
| 数据持久层 | `src/database.js` | `cinema-db.json` 自动初始化、密码哈希 |
| 业务数据访问 | `src/catalog.js` | 影片/场次/订单 CRUD |

---

## Slide 19：总结 — 技术覆盖一览

| 成员 | 页面 | 技术实现 |
|------|------|---------|
| A | 登录门户 | JWT(HS256) + RBAC(token/权限中间件) + Spring Security/Shiro 骨架 |
| B | 影片浏览 | ES(多字段权重搜索+内存降级) + Redis(Cache Aside缓存) + Nginx(least_conn) |
| C | 选座购票 | Redis(SET NX 锁座) + Sentinel(限流/熔断/3级降级) + ZooKeeper(EPHEMERAL锁) |
| D | 订单支付 | RabbitMQ(Topic交换机+3队列) + Outbox(pending→sent/failed) + Winston(JSON日志) |
| E | 管理员调价 | 读写分离(主写从读+5s同步) + Nacos(pub/sub倍率) + node:test(6用例) |
| F | 销售统计 | ECharts(双图表) + Prometheus(6指标+/metrics) + RabbitMQ(stats事件流) |
| G | 运维监控 | Docker(9服务编排) + K8s(RollingUpdate+HPA) + OTel(NodeSDK→Jaeger) |

---

## Slide 20：演示路线建议
1. `docker compose up -d` 启动全套服务
2. 用户登录 → 搜索影片 → 选座 → 下单 → 支付
3. 管理员登录 → 查看仪表盘 → 调价 → Nacos 倍率生效
4. 查看 ECharts 销售统计图表
5. 运维页查看健康/拓扑/追踪 Span
6. 访问 `/metrics` 查看 Prometheus 指标
7. 展示 K8s 部署配置（`kubectl apply -f k8s/`）
