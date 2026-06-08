import { apiFetch, authHeaders, getSession, logout } from "../common.js";

const { createApp } = Vue;

createApp({
  data() {
    return {
      session: getSession(),
      logout,
      dashboard: null,
      priceDrafts: {},
      notice: "",
    };
  },
  computed: {
    isAdmin() {
      return this.session?.user?.role === "ADMIN";
    },
  },
  async mounted() {
    await this.loadDashboard();
  },
  methods: {
    async loadDashboard() {
      if (!this.isAdmin) return;
      this.dashboard = await apiFetch("/api/admin/dashboard", { headers: authHeaders() });
      this.priceDrafts = Object.fromEntries(this.dashboard.shows.map((show) => [show.id, show.price]));
    },
    async updatePrice(show) {
      try {
        const price = this.priceDrafts[show.id];
        await apiFetch(`/api/admin/shows/${show.id}/price`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ price }),
        });
        this.notice = `${show.movieTitle} 票价已调整为 ￥${price}`;
        await this.loadDashboard();
      } catch (error) {
        this.notice = `调价失败：${error.message}`;
      }
    },
  },
}).mount("#app");
