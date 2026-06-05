import { apiFetch, authHeaders, getSession, logout } from "../common.js";

const { createApp, nextTick } = Vue;

createApp({
  data() {
    return { session: getSession(), logout, dashboard: null, stats: {}, salesChart: null, heatChart: null };
  },
  computed: {
    isAdmin() {
      return this.session?.user?.role === "ADMIN";
    },
  },
  async mounted() {
    await this.refreshAll();
    window.addEventListener("resize", () => {
      this.salesChart?.resize();
      this.heatChart?.resize();
    });
  },
  methods: {
    async refreshAll() {
      if (!this.isAdmin) return;
      this.dashboard = await apiFetch("/api/admin/dashboard", { headers: authHeaders() });
      this.stats = await apiFetch("/api/admin/stats");
      await nextTick();
      this.renderCharts();
    },
    renderCharts() {
      const movies = this.stats.movies || [];
      const salesEl = document.getElementById("salesChart");
      if (salesEl && window.echarts) {
        if (!this.salesChart) this.salesChart = echarts.init(salesEl);
        this.salesChart.setOption({
          tooltip: { trigger: "axis" },
          legend: { bottom: 0, textStyle: { color: "#9fb2c9" } },
          grid: { left: 36, right: 12, top: 20, bottom: 54 },
          xAxis: { type: "category", data: movies.map((movie) => movie.title), axisLabel: { interval: 0, fontSize: 11, color: "#9fb2c9" } },
          yAxis: { type: "value", axisLabel: { color: "#9fb2c9" } },
          series: [
            { name: "已售", type: "bar", stack: "seat", data: movies.map((movie) => movie.soldSeats), itemStyle: { color: "#ff6f91" } },
            { name: "可售", type: "bar", stack: "seat", data: movies.map((movie) => movie.availableSeats), itemStyle: { color: "#62f5ff" } },
          ],
        });
      }
      const heatEl = document.getElementById("heatChart");
      if (heatEl && window.echarts) {
        if (!this.heatChart) this.heatChart = echarts.init(heatEl);
        this.heatChart.setOption({
          tooltip: { trigger: "axis" },
          grid: { left: 44, right: 18, top: 24, bottom: 40 },
          xAxis: { type: "category", data: movies.map((movie) => movie.title), axisLabel: { interval: 0, fontSize: 11, color: "#9fb2c9" } },
          yAxis: { type: "value", axisLabel: { color: "#9fb2c9" } },
          series: [{ name: "收入", type: "bar", data: movies.map((movie) => movie.revenue), itemStyle: { color: "#ffd166" } }],
        });
      }
    },
  },
}).mount("#app");
