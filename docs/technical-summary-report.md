# 技术汇总报告

项目名称：影院订票系统

## 1. 系统功能

本项目实现一个真实可运行的影院订票软件，分为用户端和管理员后台端。

用户端功能：

- 用户账号密码登录。
- 查看热映影片、影院、场次、价格。
- 在线选择座位。
- 提交订单并临时锁座。
- 支付确认后座位变为已售。

管理员后台功能：

- 管理员账号密码登录。
- 查看购买情况：订单数、待支付数、售出座位、收入。
- 查看最近订单。
- 调整各场次票价。
- 查看销售图表和收入图表。
- 所有业务数据持久化到 `data/cinema-db.json`，不是页面临时模拟数据。

## 2. 真实数据设计

系统使用本地持久化数据文件作为轻量数据库：

- 文件路径：`data/cinema-db.json`
- 保存内容：用户、影片、场次、座位、订单、已售座位、票价。
- 用户登录：从数据文件中的用户表校验账号和密码哈希。
- 用户购票：订单写入数据文件。
- 支付确认：订单状态更新为 `PAID`，对应座位写入已售列表。
- 管理员调价：直接更新场次价格，用户端刷新后看到新价格。

首次启动时如果数据文件不存在，系统会自动创建初始业务数据；之后所有操作都会持续写回文件。

## 3. 课程技术对应

| 技术 | 对应实现 |
| --- | --- |
| Spring Security | 报告与 Spring 后端骨架中设计为登录认证/JWT 鉴权；Node 主系统实现真实 token 会话 |
| Shiro | Spring 后端骨架中设计为后台权限；主系统通过 ADMIN 角色保护后台接口 |
| ZooKeeper | `docker-compose.yml` 中提供协调服务 |
| Hybrid Flask | `services/flask-recommender` 推荐服务 |
| Docker | `Dockerfile`、`docker-compose.yml` |
| 数据库读写分离 | `spring-backend` 中保留 DynamicDataSource 设计 |
| MQ | Redis List 事件队列记录下单、支付、调价事件 |
| Nginx | `infra/nginx/nginx.conf` |
| 负载均衡 | Nginx upstream 转发到两个 Web 实例 |
| Elasticsearch | 搜索接口保留本地兜底，Compose 中提供 Elasticsearch |
| 前端技术 | Vue |
| ECharts | 销售图表、收入图表 |
| Sentinel/Nacos | `docker-compose.yml` 和 Spring 配置中保留 |
| RabbitMQ | `docker-compose.yml` 和 Spring 订单消息模块中保留 |
| Kubernetes | `k8s/` 配置 |
| Slf4j/logback | `spring-backend/src/main/resources/logback-spring.xml` |
| JUnit | `spring-backend/src/test` 和 Node `node --test` |
| Redis | 座位临时锁、事件队列 |
| Prometheus | `/metrics` 指标 |

## 4. 可用性设计

- 防超卖：下单时使用 Redis `SET NX EX` 临时锁定座位。
- 权限隔离：用户只能购票，管理员才能查看后台和调价。
- 超时释放：订单未支付时座位锁会过期释放。
- 可观测：Prometheus 指标、健康检查、结构化日志和事件队列。
- 降级：Redis 不可用时单机演示可降级到内存锁。

## 5. 演示路线

1. 打开 `http://localhost:3000`。
2. 点击登录，使用用户账号 `13800000000 / 123456`。
3. 选择影片、场次、座位，提交订单并支付。
4. 退出后点击管理员入口，使用 `admin / admin123`。
5. 查看购买情况和最近订单。
6. 修改某个场次票价，回到购票区查看价格变化。
7. 重启服务，展示订单和调价数据仍然存在。
8. 打开 `/metrics` 展示 Prometheus 指标。
