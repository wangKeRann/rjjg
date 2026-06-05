# 影院订票系统

这是一个可运行的影院订票课程项目，包含用户端、管理员后台、运维监控、真实登录、真实下单、真实支付、管理员调价、销售统计和本地持久化数据。

## 账号

- 用户端：`user` / `user123`
- 备用用户端：`13800000000` / `123456`
- 管理员：`admin` / `admin123`

登录成功后会按角色跳转：

- 用户登录后进入 `movies.html`
- 管理员登录后进入 `admin-shows.html`

系统页面顶部导航会按角色显示：

- 用户只显示：影片、选座、订单
- 管理员只显示：调价、统计、运维

## 启动

```powershell
npm install
npm start
```

访问：

- 登录页：`http://localhost:3000/login.html`
- 影片浏览页：`http://localhost:3000/movies.html`
- 场次与选座购票页：`http://localhost:3000/booking.html`
- 订单支付页：`http://localhost:3000/orders.html`
- 管理员场次调价页：`http://localhost:3000/admin-shows.html`
- 管理员销售统计页：`http://localhost:3000/admin-sales.html`
- 运维监控页：`http://localhost:3000/ops.html`
- 健康检查：`http://localhost:3000/api/health`
- Prometheus 指标：`http://localhost:3000/metrics`

## 7 人分工与技术栈

| 成员 | 页面 | 技术 1 | 技术 2 | 技术 3 | 主要修改文件 |
| --- | --- | --- | --- | --- | --- |
| A | 登录与门户页 | Spring Security | Shiro | JWT/RBAC | `public/login.html`、`public/js/pages/login.js`、`src/auth.js` |
| B | 影片与影院浏览页 | Elasticsearch | Redis | Nginx | `public/movies.html`、`public/js/pages/movies.js`、`src/server.js` 的搜索接口 |
| C | 场次与选座购票页 | Redis | Sentinel | ZooKeeper | `public/booking.html`、`public/js/pages/booking.js`、`src/redisStore.js`、`src/server.js` 的下单接口 |
| D | 订单与支付页 | RabbitMQ | Outbox | Slf4j/logback | `public/orders.html`、`public/js/pages/orders.js`、`src/server.js` 的支付/取消接口 |
| E | 管理员场次调价页 | 数据库读写分离 | Nacos | JUnit | `public/admin-shows.html`、`public/js/pages/admin-shows.js`、`src/catalog.js`、`test/api.test.js` |
| F | 管理员销售统计页 | ECharts | Prometheus | Kafka 或 RabbitMQ | `public/admin-sales.html`、`public/js/pages/admin-sales.js`、`src/server.js` 的统计接口 |
| G | 运维监控页 | Docker/Kubernetes | Nginx/负载均衡 | Grafana/OpenTelemetry | `public/ops.html`、`public/js/pages/ops.js`、`docker-compose.yml`、`Dockerfile`、`k8s/`、`infra/` |

## 每个成员具体负责什么

### 成员 A：登录与门户页

页面入口：

- `http://localhost:3000/login.html`

主要文件：

- `public/login.html`：登录页结构、猫猫视觉、登录表单。
- `public/js/pages/login.js`：登录请求、角色识别、登录成功跳转。
- `src/auth.js`：真实账号密码校验、token/session、权限中间件。
- `src/database.js`：用户账号种子数据。

技术说明：

- Spring Security：对应登录认证、token 颁发、接口鉴权思想。
- Shiro：对应角色权限控制思想，区分用户和管理员。
- JWT/RBAC：对应 token 登录态与基于角色的页面/接口访问控制。

### 成员 B：影片与影院浏览页

页面入口：

- `http://localhost:3000/movies.html`

主要文件：

- `public/movies.html`：影片列表、搜索栏、筛选区。
- `public/js/pages/movies.js`：读取影片、影院、搜索结果。
- `src/server.js`：`GET /api/movies`、`GET /api/cinemas`、`GET /api/search`。
- `src/catalog.js`：影片、影院、场次数据读取。

技术说明：

- Elasticsearch：对应影片、影院、标签、影厅的全文检索设计。
- Redis：对应热门影片、搜索结果、影院信息缓存设计。
- Nginx：对应统一入口、静态资源代理和搜索接口转发。

### 成员 C：场次与选座购票页

页面入口：

- `http://localhost:3000/booking.html`

主要文件：

- `public/booking.html`：场次列表、座位图、订单确认区。
- `public/js/pages/booking.js`：选座、锁座、创建订单、支付确认。
- `src/redisStore.js`：Redis 锁座和事件队列，Redis 不可用时降级到内存模式。
- `src/server.js`：`GET /api/shows/:showId/seats`、`POST /api/orders`。

技术说明：

- Redis：临时锁座，防止同一座位被多人同时购买。
- Sentinel：对应热门场次下单接口限流、熔断、降级设计。
- ZooKeeper：对应分布式协调、服务节点注册、锁服务协调设计。

### 成员 D：订单与支付页

页面入口：

- `http://localhost:3000/orders.html`

主要文件：

- `public/orders.html`：我的订单列表、待支付订单操作。
- `public/js/pages/orders.js`：读取个人订单、继续支付。
- `src/server.js`：`GET /api/my/orders`、`POST /api/orders/:orderId/pay`、`POST /api/orders/:orderId/cancel`。
- `src/redisStore.js`：订单事件发布，模拟 MQ 事件流。

技术说明：

- RabbitMQ：对应订单创建、支付成功、取消订单后的异步事件。
- Outbox：对应订单状态变更与消息投递的一致性设计。
- Slf4j/logback：对应结构化日志，记录下单、支付、取消、异常。

### 成员 E：管理员场次调价页

页面入口：

- `http://localhost:3000/admin-shows.html`

主要文件：

- `public/admin-shows.html`：管理员场次表格、票价输入、保存按钮。
- `public/js/pages/admin-shows.js`：读取后台数据、提交调价。
- `src/catalog.js`：更新场次票价、读取后台场次。
- `src/server.js`：`GET /api/admin/dashboard`、`PATCH /api/admin/shows/:showId/price`。
- `test/api.test.js`：管理员调价测试。

技术说明：

- 数据库读写分离：查询走读库思想，调价写主库思想。
- Nacos：对应票价策略、活动配置、服务配置中心设计。
- JUnit：对应后台调价接口的自动化测试思想；当前 Node 项目用 `node --test` 实现同类测试。

### 成员 F：管理员销售统计页

页面入口：

- `http://localhost:3000/admin-sales.html`

主要文件：

- `public/admin-sales.html`：销售统计页面结构、图表容器、订单表。
- `public/js/pages/admin-sales.js`：ECharts 图表渲染、后台统计刷新。
- `src/server.js`：`GET /api/admin/dashboard`、`GET /api/admin/stats`、`GET /metrics`。

技术说明：

- ECharts：收入图表、售出票数图表。
- Prometheus：接口耗时、订单创建数、支付数、Redis 模式等指标。
- Kafka 或 RabbitMQ：对应销售统计事件流，支付成功后异步更新统计。

### 成员 G：运维监控页

页面入口：

- `http://localhost:3000/ops.html`

主要文件：

- `public/ops.html`：健康状态、部署拓扑、最近事件。
- `public/js/pages/ops.js`：读取健康检查、拓扑和事件。
- `Dockerfile`：应用容器镜像。
- `docker-compose.yml`：本地编排 Node、Redis、Prometheus、Nginx 等组件。
- `infra/nginx/nginx.conf`：Nginx 反向代理和负载均衡配置。
- `infra/prometheus/prometheus.yml`：Prometheus 抓取配置。
- `k8s/`：Kubernetes 部署配置。

技术说明：

- Docker/Kubernetes：容器化部署和集群编排。
- Nginx/负载均衡：统一入口、多实例转发。
- Grafana/OpenTelemetry：监控大屏和链路追踪设计。

## 公共文件

这些文件可能会被多个成员共用，修改前最好先沟通：

- `public/styles.css`：全站科技未来风格、玻璃拟态、响应式布局。
- `public/js/common.js`：登录态、鉴权请求头、退出登录、公共 API 请求工具。
- `src/server.js`：后端 REST API、Prometheus 指标、订单流程。
- `src/database.js`：本地持久化数据文件初始化。
- `src/catalog.js`：影片、场次、订单、票价的数据访问。
- `src/redisStore.js`：Redis 锁座、事件队列、内存降级。

## 数据说明

系统首次启动会自动创建本地数据文件：

```text
data/cinema-db.json
```

用户、影片、场次、订单、已售座位、管理员调价都会写入这个文件。下单支付和调价不是只改内存，重启服务后数据仍然保留。

## 测试

```powershell
npm test
```

当前测试覆盖：

- 用户必须登录后才能下单。
- 用户可以锁座、创建订单、支付订单。
- 管理员可以查看后台数据并修改票价。
- 影片搜索接口可用。

## 工程配置

课程要求中的架构技术配置保留在项目中：

- `docker-compose.yml`
- `Dockerfile`
- `infra/nginx/nginx.conf`
- `infra/prometheus/prometheus.yml`
- `k8s/`
- `spring-backend/`
- `services/flask-recommender/`
