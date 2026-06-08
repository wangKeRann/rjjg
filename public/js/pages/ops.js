import { apiFetch, authHeaders, getSession, logout } from "../common.js";

const { createApp } = Vue;

createApp({
  data() {
    return { session: getSession(), logout, health: {}, topology: {}, events: [] };
  },
  async mounted() {
    await this.loadOps();
  },
  methods: {
    async loadOps() {
      this.health = await apiFetch("/api/health");
      this.topology = await apiFetch("/api/infrastructure/topology");
      this.events = (await apiFetch("/api/ops/events", { headers: authHeaders() })).events;
    },
  },
}).mount("#app");
