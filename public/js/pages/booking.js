import { apiFetch, authHeaders, getSession, logout } from "../common.js";

const { createApp } = Vue;

createApp({
  data() {
    return {
      session: getSession(),
      logout,
      movies: [],
      allShows: [],
      selectedMovie: null,
      selectedShowId: new URLSearchParams(location.search).get("showId") || "",
      seats: [],
      selectedSeats: [],
      currentShow: null,
      currentOrder: null,
      lockTtlSeconds: 120,
      busy: false,
      notice: "",
    };
  },
  computed: {
    isCustomer() {
      return this.session?.user?.role === "CUSTOMER";
    },
    selectedAmount() {
      return this.selectedSeats.length * (this.currentShow?.price || 0);
    },
    canCreateOrder() {
      return this.isCustomer && this.selectedSeats.length > 0 && !this.busy && !this.canPayOrder;
    },
    canPayOrder() {
      return this.isCustomer && this.currentOrder?.status === "PENDING_PAYMENT" && !this.busy;
    },
  },
  async mounted() {
    await this.loadMovies();
    if (!this.selectedShowId) this.selectedShowId = this.allShows[0]?.id || "";
    await this.selectShow(this.selectedShowId);
  },
  methods: {
    async loadMovies() {
      const payload = await apiFetch("/api/movies");
      this.movies = payload.movies;
      this.allShows = this.movies.flatMap((movie) =>
        movie.shows.map((show) => ({ ...show, movieTitle: movie.title })),
      );
    },
    async selectShow(showId) {
      if (!showId || this.busy) return;
      this.selectedShowId = showId;
      const show = this.allShows.find((item) => item.id === showId);
      this.selectedMovie = this.movies.find((movie) => movie.id === show?.movieId) || null;
      this.currentOrder = null;
      this.notice = "";
      await this.loadSeats();
    },
    async loadSeats(clearSelection = true) {
      if (!this.selectedShowId) return;
      const data = await apiFetch(`/api/shows/${this.selectedShowId}/seats`);
      this.seats = data.seats;
      this.currentShow = data.show;
      if (clearSelection) {
        this.selectedSeats = [];
        return;
      }

      const selectable = new Set(this.seats.filter((seat) => seat.status === "available").map((seat) => seat.id));
      if (this.currentOrder?.status === "PENDING_PAYMENT") {
        this.selectedSeats = [...this.currentOrder.seats];
      } else {
        this.selectedSeats = this.selectedSeats.filter((seatId) => selectable.has(seatId));
      }
    },
    toggleSeat(seatId) {
      if (this.currentOrder?.status === "PENDING_PAYMENT") {
        this.notice = "当前订单已锁座，请先完成支付或切换场次重新选择。";
        return;
      }
      if (this.selectedSeats.includes(seatId)) {
        this.selectedSeats = this.selectedSeats.filter((item) => item !== seatId);
      } else {
        this.selectedSeats = [...this.selectedSeats, seatId].slice(0, 4);
      }
    },
    seatTitle(seat) {
      if (seat.status === "sold") return `${seat.id} 已售`;
      if (seat.status === "locked") return `${seat.id} 已被临时锁定`;
      if (this.selectedSeats.includes(seat.id)) return `${seat.id} 已选择`;
      return `${seat.id} 可选`;
    },
    async createOrder() {
      if (!this.isCustomer) {
        location.href = "/login.html";
        return;
      }
      if (!this.selectedSeats.length) {
        this.notice = "请先选择座位。";
        return;
      }

      this.busy = true;
      try {
        const result = await apiFetch("/api/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ showId: this.selectedShowId, seats: this.selectedSeats }),
        });
        this.currentOrder = result.order;
        this.lockTtlSeconds = result.lockTtlSeconds;
        this.selectedSeats = [...result.order.seats];
        this.notice = `订单已创建，金额 ￥${result.order.amount}，座位锁定 ${result.lockTtlSeconds} 秒。`;
        await this.loadSeats(false);
      } catch (error) {
        this.currentOrder = null;
        this.notice = `下单失败：${error.message}`;
        await this.loadSeats(false).catch(() => {});
      } finally {
        this.busy = false;
      }
    },
    async payOrder() {
      if (!this.currentOrder) return;

      this.busy = true;
      try {
        const result = await apiFetch(`/api/orders/${this.currentOrder.id}/pay`, {
          method: "POST",
          headers: authHeaders(),
        });
        this.currentOrder = result.order;
        this.notice = `支付成功：${result.order.movieTitle}，${result.order.seats.join(", ")}。`;
        this.selectedSeats = [];
        await this.loadSeats(false);
      } catch (error) {
        this.notice = `支付失败：${error.message}`;
        await this.loadSeats(false).catch(() => {});
      } finally {
        this.busy = false;
      }
    },
  },
}).mount("#app");
