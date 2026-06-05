# 7 人小组页面拆分与技术分工

## 当前页面入口

项目已经拆成 7 个真实页面入口：

```text
http://localhost:3000/login.html
http://localhost:3000/movies.html
http://localhost:3000/booking.html
http://localhost:3000/orders.html
http://localhost:3000/admin-shows.html
http://localhost:3000/admin-sales.html
http://localhost:3000/ops.html
```

每个页面都已经拆成独立 HTML 和独立 JS，同学之间可以并行开发：

| 成员 | 页面入口 | 页面文件 | 逻辑文件 |
| --- | --- | --- | --- |
| A | `/login.html` | `public/login.html` | `public/js/pages/login.js` |
| B | `/movies.html` | `public/movies.html` | `public/js/pages/movies.js` |
| C | `/booking.html` | `public/booking.html` | `public/js/pages/booking.js` |
| D | `/orders.html` | `public/orders.html` | `public/js/pages/orders.js` |
| E | `/admin-shows.html` | `public/admin-shows.html` | `public/js/pages/admin-shows.js` |
| F | `/admin-sales.html` | `public/admin-sales.html` | `public/js/pages/admin-sales.js` |
| G | `/ops.html` | `public/ops.html` | `public/js/pages/ops.js` |

公共样式在 `public/styles.css`，公共登录态和接口请求工具在 `public/js/common.js`。建议只在必要时改公共文件，避免多人合并时互相覆盖。

## 总体思路

系统拆成 7 个页面，每位同学负责一个页面。页面之间通过统一登录态、REST API、订单数据、场次数据和监控数据联动。每个页面至少体现 2 种架构技术，既能做页面，也能在答辩中讲清楚技术价值。

推荐统一风格：

- 科技未来风格。
- 深色背景、玻璃拟态卡片、清晰数据面板。
- 用户端简洁，后台端信息密度更高。
- 所有页面都保留真实业务入口，不做纯说明页。

## 1. 登录与门户页

负责人：成员 A

页面路径建议：

- `public/login.html`
- `public/js/pages/login.js`

页面功能：

- 用户登录：手机号/账号 + 密码。
- 管理员登录：管理员账号 + 密码。
- 根据角色跳转到不同页面。
- 显示当前登录用户、退出登录。
- 登录失败提示。

体现技术：

- Spring Security：负责认证、token/JWT 思路。
- Shiro：负责管理员角色和权限控制。

可演示点：

- 用户账号只能进入购票页面。
- 管理员账号可以进入后台页面。
- 普通用户访问后台接口返回权限不足。

接口建议：

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/me`

## 2. 影片与影院浏览页

负责人：成员 B

页面路径建议：

- `public/movies.html`
- `public/js/pages/movies.js`

页面功能：

- 展示热映影片。
- 支持影片搜索。
- 支持按影院、日期、影厅类型筛选。
- 展示影片评分、类型、片长、简介。
- 点击影片进入场次/选座。

体现技术：

- Elasticsearch：影片、影院、标签全文搜索。
- Redis：热门影片、热门影院、搜索结果缓存。

可演示点：

- 搜索 `IMAX`、`VIP`、影片名。
- 热门数据从缓存读取，提升查询速度。

接口建议：

- `GET /api/movies`
- `GET /api/cinemas`
- `GET /api/search?q=IMAX`

## 3. 场次与选座购票页

负责人：成员 C

页面路径建议：

- `public/booking.html`
- `public/js/pages/booking.js`

页面功能：

- 展示选中影片的场次列表。
- 展示座位图。
- 区分可选、已选、锁定、已售。
- 用户选择座位后提交订单。
- 显示订单金额和锁座倒计时。

体现技术：

- Redis：座位临时锁，防止超卖。
- Sentinel：热门场次下单接口限流和降级。

可演示点：

- 同一座位重复下单，第二次提示已锁定。
- 快速点击下单时说明 Sentinel 限流设计。

接口建议：

- `GET /api/shows/:showId/seats`
- `POST /api/orders`

## 4. 订单与支付页

负责人：成员 D

页面路径建议：

- `public/orders.html`
- `public/js/pages/orders.js`

页面功能：

- 展示当前用户订单。
- 展示待支付、已支付、已取消状态。
- 支付确认。
- 取消订单。
- 展示取票码/订单编号。

体现技术：

- RabbitMQ：支付成功后异步出票、积分发放、通知。
- Outbox Pattern：订单状态变更与消息投递可靠一致。

新增架构方法：

- 幂等设计：重复点击支付不会重复扣款或重复出票。

可演示点：

- 支付后订单状态变为 `PAID`。
- MQ 事件中出现 `ORDER_PAID`。
- 重复支付同一订单会被拒绝。

接口建议：

- `GET /api/orders/:orderId`
- `POST /api/orders/:orderId/pay`
- `POST /api/orders/:orderId/cancel`

## 5. 管理员场次与调价页

负责人：成员 E

页面路径建议：

- `public/admin-shows.html`
- `public/js/pages/admin-shows.js`

页面功能：

- 管理员查看所有影片场次。
- 查看每个场次的票价、售出座位、总座位、收入。
- 调整场次票价。
- 调价后用户端刷新可看到新价格。

体现技术：

- 数据库读写分离：调价写主库，场次查询读从库。
- Nacos：票价策略、促销配置、服务配置中心。

可演示点：

- 管理员修改票价。
- 用户端场次价格同步变化。
- 说明读写分离：查询多、写入少，降低主库压力。

接口建议：

- `GET /api/admin/dashboard`
- `PATCH /api/admin/shows/:showId/price`

## 6. 管理员订单与销售统计页

负责人：成员 F

页面路径建议：

- `public/admin-sales.html`
- `public/js/pages/admin-sales.js`

页面功能：

- 查看最近订单。
- 按影片、影院、状态筛选订单。
- 展示销售额、售出票数、待支付订单数。
- 使用图表展示影片销售排行、收入趋势。

体现技术：

- ECharts：销售图表、收入图表、影片排行。
- Prometheus：系统指标、订单指标、接口延迟指标。

新增架构方法：

- Observability：指标、日志、事件三位一体监控。

可演示点：

- 完成一次购票后后台订单数量变化。
- 图表刷新显示销售变化。
- 打开 `/metrics` 展示 Prometheus 指标。

接口建议：

- `GET /api/admin/dashboard`
- `GET /api/admin/stats`
- `GET /metrics`

## 7. 系统部署与运维监控页

负责人：成员 G

页面路径建议：

- `public/ops.html`
- `public/js/pages/ops.js`

页面功能：

- 展示系统健康状态。
- 展示 Redis、MQ、搜索服务、推荐服务状态。
- 展示部署拓扑。
- 展示最近系统事件。
- 提供 Prometheus、RabbitMQ、Nacos、Sentinel、Swagger/接口文档入口。

体现技术：

- Docker + Kubernetes：容器化和集群编排。
- Nginx + 负载均衡：统一入口和多实例分发。

可选新增技术：

- OpenTelemetry：链路追踪。
- Grafana：监控大屏。
- API Gateway：统一鉴权、路由、限流。

可演示点：

- 打开健康检查。
- 展示 Docker Compose 配置。
- 展示 K8s Deployment。
- 说明 Nginx 如何把请求分发到两个后端实例。

接口建议：

- `GET /api/health`
- `GET /api/infrastructure/topology`
- `GET /metrics`

## 页面与技术总表

| 成员 | 页面 | 主要业务 | 技术 1 | 技术 2 | 可补充技术 |
| --- | --- | --- | --- | --- | --- |
| A | 登录与门户页 | 用户/管理员登录跳转 | Spring Security | Shiro | JWT、RBAC |
| B | 影片与影院浏览页 | 搜索与筛选 | Elasticsearch | Redis | Cache Aside |
| C | 场次与选座购票页 | 选座、锁座、下单 | Redis | Sentinel | 防超卖、限流 |
| D | 订单与支付页 | 支付、取消、出票 | RabbitMQ | Outbox | 幂等设计 |
| E | 管理员场次调价页 | 查看场次、调整价格 | 数据库读写分离 | Nacos | 配置中心 |
| F | 管理员销售统计页 | 订单与销售图表 | ECharts | Prometheus | Observability |
| G | 运维监控页 | 部署、健康、拓扑 | Docker/Kubernetes | Nginx/负载均衡 | OpenTelemetry、Grafana |

## 推荐协作结构

当前已经不再要求大家挤在一个单页应用文件里开发，而是按真实页面拆开：

- HTML 负责页面结构和 Vue 模板。
- 页面 JS 负责接口请求、按钮事件、登录判断和图表渲染。
- `public/styles.css` 负责统一科技未来风格、玻璃拟态、响应式布局。
- `public/js/common.js` 负责公共登录态、鉴权请求头、退出登录和海报样式。

如果后续升级到 Vue Router，也可以继续保持这 7 个页面模块作为路由组件来源。

## 答辩分工建议

- 成员 A 讲认证与权限。
- 成员 B 讲搜索与缓存。
- 成员 C 讲锁座、防超卖、限流。
- 成员 D 讲订单支付、MQ、消息可靠性。
- 成员 E 讲后台运营、调价、读写分离和配置中心。
- 成员 F 讲销售统计、图表和监控指标。
- 成员 G 讲部署架构、负载均衡、容器化和运维。

这样每个人都有页面、有业务、有技术、有演示动作。
