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
  },
  async mounted() {
    await this.loadMovies();
    if (!this.selectedShowId) this.selectedShowId = this.allShows[0]?.id || "";
    await this.selectShow(this.selectedShowId);
  },
  methods: {
    async loadMovies() {
      this.movies = (await apiFetch("/api/movies")).movies;
      this.allShows = this.movies.flatMap((movie) => movie.shows.map((show) => ({ ...show, movieTitle: movie.title })));
    },
    async selectShow(showId) {
      this.selectedShowId = showId;
      const show = this.allShows.find((item) => item.id === showId);
      this.selectedMovie = this.movies.find((movie) => movie.id === show?.movieId) || null;
      await this.loadSeats();
    },
    async loadSeats(clearSelection = true) {
      const data = await apiFetch(`/api/shows/${this.selectedShowId}/seats`);
      this.seats = data.seats;
      this.currentShow = data.show;
      if (clearSelection) this.selectedSeats = [];
    },
    toggleSeat(seatId) {
      if (this.selectedSeats.includes(seatId)) {
        this.selectedSeats = this.selectedSeats.filter((item) => item !== seatId);
      } else {
        this.selectedSeats = [...this.selectedSeats, seatId].slice(0, 4);
      }
    },
    async createOrder() {
      if (!this.isCustomer) {
        location.href = "/login.html";
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
        this.notice = `订单已创建，金额 ￥${result.order.amount}，座位锁定 ${result.lockTtlSeconds} 秒。`;
        await this.loadSeats(false);
      } catch (error) {
        this.notice = `下单失败：${error.message}`;
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
      } finally {
        this.busy = false;
      }
    },
  },
}).mount("#app");
