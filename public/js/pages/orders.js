import { apiFetch, authHeaders, getSession, logout } from "../common.js";

const { createApp } = Vue;

createApp({
  data() {
    return { session: getSession(), logout, orders: [], notice: "" };
  },
  computed: {
    isCustomer() {
      return this.session?.user?.role === "CUSTOMER";
    },
  },
  async mounted() {
    await this.loadOrders();
  },
  methods: {
    async loadOrders() {
      if (!this.isCustomer) return;
      this.orders = (await apiFetch("/api/my/orders", { headers: authHeaders() })).orders;
    },
    async pay(order) {
      try {
        await apiFetch(`/api/orders/${order.id}/pay`, { method: "POST", headers: authHeaders() });
        this.notice = "支付成功";
        await this.loadOrders();
      } catch (error) {
        this.notice = `支付失败：${error.message}`;
      }
    },
  },
}).mount("#app");
