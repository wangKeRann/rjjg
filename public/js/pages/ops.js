import { apiFetch, getSession, logout } from "../common.js";

const { createApp } = Vue;

createApp({
  data() {
    return {
      session: getSession(),
      logout,

      // 1. 健康状态
      healthItems: [],

      // 2. 部署拓扑
      dockerServices: [],
      deployment: { replicas: "?", strategy: "?", image: "?", host: "?" },
      nginx: { algorithm: "?", servers: [], locations: [] },

      // 3. 最近事件
      prometheusMetrics: { httpRequests: 0, ordersCreated: 0, ordersPaid: 0, redisMode: "?" },
      eventStream: [],
    };
  },
  async mounted() {
    await this.loadOps();
  },
  methods: {
    async loadOps() {
      try {
        const [health, topology, eventsRes, containersRes, nginxRes, obsRes] = await Promise.all([
          apiFetch("/api/health"),
          apiFetch("/api/infrastructure/topology"),
          apiFetch("/api/ops/events"),
          apiFetch("/api/ops/containers"),
          apiFetch("/api/ops/nginx"),
          apiFetch("/api/ops/observability"),
        ]);

        // ── 1. 健康状态 ──
        this.healthItems = [
          {
            name: "Node.js 服务",
            label: "cinema-web",
            status: health.status === "UP" ? "green" : "red",
            value: health.status === "UP" ? "存活" : "异常",
          },
          {
            name: "Redis 缓存",
            label: health.redis,
            status: health.redis === "redis" ? "green" : "yellow",
            value: health.redis === "redis" ? "已连接" : "降级内存",
          },
          {
            name: "Elasticsearch",
            label: health.elasticsearch,
            status: health.elasticsearch === "elasticsearch" ? "green" : "yellow",
            value: health.elasticsearch === "elasticsearch" ? "已连接" : "降级内存",
          },
          {
            name: "Prometheus 指标",
            label: obsRes.collectorStatus?.prometheus || "—",
            status: "green",
            value: obsRes.collectorStatus?.metricsCount + " 指标",
          },
          {
            name: "OTel 追踪",
            label: obsRes.collectorStatus?.otelCollector || "—",
            status: "green",
            value: obsRes.spans.length + " spans",
          },
          {
            name: "消息队列",
            label: health.mq,
            status: health.mq === "in-memory event queue" ? "yellow" : "green",
            value: "运行中",
          },
        ];

        // ── 2. 部署拓扑 ──
        this.dockerServices = containersRes.pods || [];
        this.deployment = containersRes.deployment || {};
        this.nginx = {
          algorithm: nginxRes.algorithm,
          servers: nginxRes.upstreams.map((u) => u.server),
          locations: nginxRes.locations || [],
        };

        // ── 3. 最近事件 ──
        this.prometheusMetrics = {
          httpRequests: nginxRes.summary?.totalRequests || 0,
          ordersCreated: obsRes.collectorStatus?.ordersCreated || 0,
          ordersPaid: obsRes.collectorStatus?.ordersPaid || 0,
          redisMode: health.redis,
        };

        // 合并：OTel Spans + 系统事件
        const spanEvents = (obsRes.spans || []).map((s) => ({
          type: "Trace Span",
          source: `${s.service}  ·  ${s.duration}ms`,
          at: s.at ? new Date(s.at).toLocaleTimeString("zh-CN") : "—",
          level: s.status === "error" ? "error" : "info",
          detail: s.name,
        }));

        const sysEvents = (eventsRes.events || []).slice(0, 10).map((e) => ({
          type: e.type || "系统事件",
          source: "cinema-web",
          at: e.at ? new Date(e.at).toLocaleTimeString("zh-CN") : "—",
          level: e.type?.includes("ERROR") ? "error" : e.type?.includes("WARN") ? "warn" : "info",
          detail: JSON.stringify(e).slice(0, 120),
        }));

        this.eventStream = [...spanEvents, ...sysEvents]
          .sort((a, b) => (b.at > a.at ? 1 : -1))
          .slice(0, 20);
      } catch (e) {
        console.error("ops load error", e);
      }
    },
  },
}).mount("#app");
