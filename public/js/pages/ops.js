import { apiFetch, getSession, logout } from "../common.js";

const { createApp, nextTick } = Vue;

createApp({
  data() {
    return {
      session: getSession(),
      logout,
      health: {},
      topology: {},
      events: [],
      containers: { summary: {}, pods: [], cpuHistory: [], deployment: {} },
      nginx: { upstreams: [], trafficHistory: [], statusCodes: [], summary: {}, algorithm: "" },
      observability: { traceLatency: [], serviceHealth: [], spans: [], collectorStatus: {} },
      charts: {},
      kpis: [
        { label: "健康状态", value: "—", sub: "检查中…", status: "" },
        { label: "容器运行", value: "—", sub: "检查中…", status: "ok" },
        { label: "请求速率", value: "—", sub: "检查中…", status: "ok" },
        { label: "P95 延迟", value: "—", sub: "检查中…", status: "ok" },
      ],
    };
  },
  async mounted() {
    await this.loadOps();
    window.addEventListener("resize", this.resizeAllCharts);
  },
  beforeUnmount() {
    window.removeEventListener("resize", this.resizeAllCharts);
    Object.values(this.charts).forEach((c) => c?.dispose());
  },
  methods: {
    async loadOps() {
      try {
        const [health, topology, eventsData, containers, nginx, observability] = await Promise.all([
          apiFetch("/api/health"),
          apiFetch("/api/infrastructure/topology"),
          apiFetch("/api/ops/events"),
          apiFetch("/api/ops/containers"),
          apiFetch("/api/ops/nginx"),
          apiFetch("/api/ops/observability"),
        ]);
        this.health = health;
        this.topology = topology;
        this.events = eventsData.events;
        this.containers = containers;
        this.nginx = nginx;
        this.observability = observability;

        this.kpis[0].value = health.status === "UP" ? "UP" : "DOWN";
        this.kpis[0].status = health.status === "UP" ? "ok" : "error";
        this.kpis[0].sub = `Redis: ${health.redis}`;

        this.kpis[1].value = `${containers.summary.running}/${containers.summary.total}`;
        this.kpis[1].sub = `运行中`;
        this.kpis[1].status = containers.summary.failed === 0 ? "ok" : "warn";

        this.kpis[2].value = `${nginx.summary.totalRequests}`;
        this.kpis[2].sub = `活跃 ${nginx.summary.activeConns}`;
        this.kpis[2].status = "ok";

        const p95 = observability.traceLatency.length
          ? Math.max(...observability.traceLatency.map((t) => t.p95))
          : 0;
        this.kpis[3].value = `${p95}ms`;
        this.kpis[3].sub = `P99: ${observability.traceLatency.length ? Math.max(...observability.traceLatency.map((t) => t.p99)) : 0}ms`;
        this.kpis[3].status = p95 < 200 ? "ok" : "warn";

        await nextTick();
        this.renderAllCharts();
      } catch (e) {
        console.error("ops load error", e);
      }
    },
    renderAllCharts() {
      this.renderPodStatusChart();
      this.renderCpuChart();
      this.renderTrafficPieChart();
      this.renderRequestRateChart();
      this.renderTraceLatencyChart();
      this.renderServiceHealthChart();
    },
    resizeAllCharts() {
      Object.values(this.charts).forEach((c) => c?.resize());
    },
    initChart(domId) {
      const el = document.getElementById(domId);
      if (!el || !window.echarts) return null;
      if (this.charts[domId]) this.charts[domId].dispose();
      const chart = echarts.init(el);
      this.charts[domId] = chart;
      return chart;
    },

    // --- Docker/K8s charts ---
    renderPodStatusChart() {
      const chart = this.initChart("chart-pod-status");
      if (!chart) return;
      const s = this.containers.summary;
      chart.setOption({
        tooltip: { trigger: "item" },
        legend: { bottom: 0, textStyle: { color: "#9fb2c9", fontSize: 11 } },
        series: [{
          type: "pie",
          radius: ["54%", "78%"],
          center: ["50%", "46%"],
          label: { color: "#9fb2c9", fontSize: 11 },
          data: [
            { value: s.running || 0, name: "Running", itemStyle: { color: "#74f0a7" } },
            { value: s.pending || 0, name: "Pending", itemStyle: { color: "#ffd166" } },
            { value: s.failed || 0, name: "Failed", itemStyle: { color: "#ff6f91" } },
          ],
        }],
      });
    },
    renderCpuChart() {
      const chart = this.initChart("chart-cpu");
      if (!chart) return;
      const data = this.containers.cpuHistory || [];
      chart.setOption({
        tooltip: { trigger: "axis" },
        legend: { bottom: 0, textStyle: { color: "#9fb2c9", fontSize: 11 } },
        grid: { left: 40, right: 12, top: 16, bottom: 40 },
        xAxis: { type: "category", data: data.map((d) => d.time), axisLabel: { fontSize: 10, color: "#9fb2c9" } },
        yAxis: { type: "value", name: "cores", axisLabel: { color: "#9fb2c9" }, splitLine: { lineStyle: { color: "rgba(126,210,255,0.1)" } } },
        series: [
          { name: "cinema-web", type: "line", data: data.map((d) => d["cinema-web"]), smooth: true, lineStyle: { color: "#62f5ff" }, itemStyle: { color: "#62f5ff" } },
          { name: "spring-security", type: "line", data: data.map((d) => d["spring-security"]), smooth: true, lineStyle: { color: "#77a7ff" }, itemStyle: { color: "#77a7ff" } },
        ],
      });
    },

    // --- Nginx/LB charts ---
    renderTrafficPieChart() {
      const chart = this.initChart("chart-traffic-pie");
      if (!chart) return;
      const upstreams = this.nginx.upstreams || [];
      chart.setOption({
        tooltip: { trigger: "item" },
        legend: { bottom: 0, textStyle: { color: "#9fb2c9", fontSize: 11 } },
        series: [{
          type: "pie",
          radius: ["54%", "78%"],
          center: ["50%", "46%"],
          label: { color: "#9fb2c9", fontSize: 11 },
          data: upstreams.map((u) => ({
            value: u.totalRequests,
            name: u.server,
          })),
        }],
      });
    },
    renderRequestRateChart() {
      const chart = this.initChart("chart-request-rate");
      if (!chart) return;
      const data = this.nginx.trafficHistory || [];
      chart.setOption({
        tooltip: { trigger: "axis" },
        legend: { bottom: 0, textStyle: { color: "#9fb2c9", fontSize: 11 } },
        grid: { left: 40, right: 12, top: 16, bottom: 40 },
        xAxis: { type: "category", data: data.map((d) => d.time), axisLabel: { fontSize: 10, color: "#9fb2c9" } },
        yAxis: { type: "value", name: "req/min", axisLabel: { color: "#9fb2c9" }, splitLine: { lineStyle: { color: "rgba(126,210,255,0.1)" } } },
        series: [
          { name: "cinema-web-a", type: "line", data: data.map((d) => d["cinema-web-a"]), smooth: true, areaStyle: { opacity: 0.15 }, lineStyle: { color: "#ffd166" }, itemStyle: { color: "#ffd166" } },
          { name: "cinema-web-b", type: "line", data: data.map((d) => d["cinema-web-b"]), smooth: true, areaStyle: { opacity: 0.15 }, lineStyle: { color: "#62f5ff" }, itemStyle: { color: "#62f5ff" } },
        ],
      });
    },

    // --- Grafana/OTel charts ---
    renderTraceLatencyChart() {
      const chart = this.initChart("chart-trace-latency");
      if (!chart) return;
      const data = this.observability.traceLatency || [];
      chart.setOption({
        tooltip: { trigger: "axis" },
        legend: { bottom: 0, textStyle: { color: "#9fb2c9", fontSize: 11 } },
        grid: { left: 44, right: 12, top: 16, bottom: 40 },
        xAxis: { type: "category", data: data.map((d) => d.time), axisLabel: { fontSize: 10, color: "#9fb2c9" } },
        yAxis: { type: "value", name: "ms", axisLabel: { color: "#9fb2c9" }, splitLine: { lineStyle: { color: "rgba(126,210,255,0.1)" } } },
        series: [
          { name: "P50", type: "line", data: data.map((d) => d.p50), smooth: true, lineStyle: { color: "#74f0a7" }, itemStyle: { color: "#74f0a7" } },
          { name: "P95", type: "line", data: data.map((d) => d.p95), smooth: true, lineStyle: { color: "#ffd166" }, itemStyle: { color: "#ffd166" } },
          { name: "P99", type: "line", data: data.map((d) => d.p99), smooth: true, lineStyle: { color: "#ff6f91" }, itemStyle: { color: "#ff6f91" } },
        ],
      });
    },
    renderServiceHealthChart() {
      const chart = this.initChart("chart-service-health");
      if (!chart) return;
      const services = this.observability.serviceHealth || [];
      chart.setOption({
        tooltip: { trigger: "axis" },
        grid: { left: 100, right: 12, top: 12, bottom: 24 },
        xAxis: { type: "value", name: "ms", axisLabel: { color: "#9fb2c9" }, splitLine: { lineStyle: { color: "rgba(126,210,255,0.1)" } } },
        yAxis: {
          type: "category",
          data: services.map((s) => s.service),
          axisLabel: { fontSize: 11, color: "#9fb2c9" },
        },
        series: [{
          type: "bar",
          data: services.map((s) => ({
            value: s.avgLatency,
            itemStyle: { color: s.status === "healthy" ? "#74f0a7" : s.status === "degraded" ? "#ffd166" : "#ff6f91" },
          })),
          label: { show: true, position: "right", color: "#9fb2c9", fontSize: 10, formatter: (p) => `${p.value}ms` },
        }],
      });
    },
  },
}).mount("#app");
