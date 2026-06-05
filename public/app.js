const { createApp, nextTick } = Vue;

const pageCopy = {
  login: ["登录页", "选择用户端或管理员端，进入对应工作台。"],
  movies: ["影片浏览页", "搜索影片和影院，筛选场次并进入购票。"],
  booking: ["场次与选座购票页", "选择场次、座位，提交订单并确认支付。"],
  orders: ["订单支付页", "查看个人订单，继续支付待支付订单。"],
  adminShows: ["管理员场次调价页", "查看场次售卖情况，并调整票价。"],
  adminSales: ["管理员销售统计页", "查看订单、收入和销售图表。"],
  ops: ["运维监控页", "查看健康状态、部署拓扑和系统事件。"],
};

createApp({
  data() {
    return {
      view: "movies",
      session: null,
      loginMode: "customer",
      loginForms: {
        customer: { login: "13800000000", password: "123456" },
        admin: { login: "admin", password: "admin123" },
      },
      health: {},
      movies: [],
      cinemas: [],
      searchQuery: "",
      searchResult: null,
      selectedMovie: null,
      selectedShowId: "",
      seats: [],
      selectedSeats: [],
      currentShow: null,
      currentOrder: null,
      myOrders: [],
      stats: {},
      adminDashboard: null,
      priceDrafts: {},
      topology: {},
      opsEvents: [],
      salesChart: null,
      heatChart: null,
      busy: false,
      notice: "",
      sortMode: "heat",
      filters: {
        city: "上海",
        date: "今天 06-04",
        cinema: "",
        format: "",
      },
    };
  },
  computed: {
    isCustomer() {
      return this.session?.user?.role === "CUSTOMER";
    },
    isAdmin() {
      return this.session?.user?.role === "ADMIN";
    },
    pageTitle() {
      return pageCopy[this.view]?.[0] || "影院订票系统";
    },
    pageSubtitle() {
      return pageCopy[this.view]?.[1] || "选择电影、锁定座位、确认支付。";
    },
    sortedMovies() {
      const rows = [...this.movies];
      if (this.sortMode === "rating") return rows.sort((a, b) => b.rating - a.rating);
      if (this.sortMode === "price") return rows.sort((a, b) => this.lowestPrice(a) - this.lowestPrice(b));
      return rows.sort((a, b) => b.heat - a.heat);
    },
    displayedMovies() {
      return this.searchResult?.movies?.length ? this.searchResult.movies : this.sortedMovies;
    },
    filteredShows() {
      const shows = this.selectedMovie?.shows || [];
      return shows.filter((show) => {
        const matchCinema = !this.filters.cinema || show.cinema === this.filters.cinema;
        const matchFormat = !this.filters.format || show.format === this.filters.format;
        return matchCinema && matchFormat;
      });
    },
    selectedAmount() {
      return this.selectedSeats.length * (this.currentShow?.price || 0);
    },
  },
  watch: {
    filteredShows(shows) {
      if (!shows.find((show) => show.id === this.selectedShowId)) {
        this.selectedShowId = shows[0]?.id || "";
        this.loadSeats();
      }
    },
  },
  async mounted() {
    this.restoreSession();
    this.syncViewFromHash();
    window.addEventListener("hashchange", this.syncViewFromHash);
    await this.refreshAll();
    window.addEventListener("resize", () => {
      this.salesChart?.resize();
      this.heatChart?.resize();
    });
  },
  methods: {
    authHeaders() {
      return this.session?.token ? { Authorization: `Bearer ${this.session.token}` } : {};
    },
    syncViewFromHash() {
      const map = {
        "#/login": "login",
        "#/movies": "movies",
        "#/booking": "booking",
        "#/orders": "orders",
        "#/admin/shows": "adminShows",
        "#/admin/sales": "adminSales",
        "#/ops": "ops",
      };
      this.view = map[window.location.hash] || "movies";
      this.afterViewChange();
    },
    go(view) {
      const map = {
        login: "#/login",
        movies: "#/movies",
        booking: "#/booking",
        orders: "#/orders",
        adminShows: "#/admin/shows",
        adminSales: "#/admin/sales",
        ops: "#/ops",
      };
      window.location.hash = map[view] || "#/movies";
    },
    async afterViewChange() {
      await nextTick();
      if (this.view === "orders") await this.loadMyOrders();
      if (this.view === "adminShows" || this.view === "adminSales") await this.loadAdminDashboard(false);
      if (this.view === "ops") await this.loadOps();
      this.renderCharts();
    },
    restoreSession() {
      const raw = localStorage.getItem("cinema-session");
      if (!raw) return;
      try {
        this.session = JSON.parse(raw);
      } catch (_) {
        localStorage.removeItem("cinema-session");
      }
    },
    saveSession(session) {
      this.session = session;
      localStorage.setItem("cinema-session", JSON.stringify(session));
    },
    setLoginMode(mode) {
      this.loginMode = mode;
    },
    async submitLogin(mode) {
      try {
        const form = this.loginForms[mode];
        const result = await fetchJson("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ portal: mode, login: form.login, password: form.password }),
        });
        this.saveSession(result);
        this.notice = `${result.user.displayName} 登录成功`;
        if (result.portal === "admin") {
          await this.loadAdminDashboard(false);
          this.go("adminShows");
        } else {
          this.go("movies");
        }
      } catch (error) {
        this.notice = `登录失败：${error.message}`;
      }
    },
    async logout() {
      if (this.session?.token) {
        await fetchJson("/api/auth/logout", { method: "POST", headers: this.authHeaders() }).catch(() => {});
      }
      this.session = null;
      this.adminDashboard = null;
      this.myOrders = [];
      this.currentOrder = null;
      localStorage.removeItem("cinema-session");
      this.notice = "已退出登录";
      this.go("login");
    },
    async refreshAll() {
      await this.refreshHealth();
      await Promise.all([this.loadMovies(), this.loadCinemas(), this.refreshStats()]);
      if (this.isAdmin) await this.loadAdminDashboard(false);
      if (this.isCustomer) await this.loadMyOrders();
    },
    async refreshHealth() {
      this.health = await fetchJson("/api/health");
    },
    async loadMovies() {
      const data = await fetchJson("/api/movies");
      this.movies = data.movies;
      if (!this.selectedMovie && this.movies.length) await this.selectMovie(this.movies[0]);
    },
    async loadCinemas() {
      this.cinemas = (await fetchJson("/api/cinemas")).cinemas;
    },
    async runSearch() {
      if (!this.searchQuery.trim()) {
        this.searchResult = null;
        return;
      }
      this.searchResult = await fetchJson(`/api/search?q=${encodeURIComponent(this.searchQuery.trim())}`);
    },
    async loadMyOrders() {
      if (!this.isCustomer) return;
      this.myOrders = (await fetchJson("/api/my/orders", { headers: this.authHeaders() })).orders;
    },
    async loadAdminDashboard(showNotice = true) {
      if (!this.isAdmin) return;
      this.adminDashboard = await fetchJson("/api/admin/dashboard", { headers: this.authHeaders() });
      this.priceDrafts = Object.fromEntries(this.adminDashboard.shows.map((show) => [show.id, show.price]));
      await nextTick();
      this.renderCharts();
      if (showNotice) this.notice = "后台数据已刷新";
    },
    async loadOps() {
      await this.refreshHealth();
      this.topology = await fetchJson("/api/infrastructure/topology");
      this.opsEvents = (await fetchJson("/api/ops/events")).events;
    },
    async updatePrice(show) {
      const price = this.priceDrafts[show.id];
      try {
        await fetchJson(`/api/admin/shows/${show.id}/price`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...this.authHeaders() },
          body: JSON.stringify({ price }),
        });
        await this.loadMovies();
        await this.loadAdminDashboard(false);
        await this.loadSeats(false);
        this.notice = `${show.movieTitle} 票价已调整为 ￥${price}`;
      } catch (error) {
        this.notice = `调价失败：${error.message}`;
      }
    },
    lowestPrice(movie) {
      return Math.min(...movie.shows.map((show) => show.price));
    },
    posterStyle(movie) {
      return {
        background: `
          radial-gradient(circle at 30% 18%, ${movie.accent || "#ffffff"} 0, transparent 28%),
          linear-gradient(145deg, ${movie.posterTone}, #141820 72%)
        `,
      };
    },
    async selectMovieAndBook(movie) {
      await this.selectMovie(movie);
      this.go("booking");
    },
    async selectMovie(movie) {
      this.selectedMovie = movie;
      this.currentOrder = null;
      const candidate = this.filteredShows[0] || movie.shows[0];
      this.selectedShowId = candidate?.id || "";
      await this.loadSeats();
    },
    async selectShow(showId) {
      this.selectedShowId = showId;
      this.currentOrder = null;
      await this.loadSeats();
    },
    async loadSeats(clearSelection = true) {
      if (!this.selectedShowId) {
        this.seats = [];
        this.currentShow = null;
        return;
      }
      const data = await fetchJson(`/api/shows/${this.selectedShowId}/seats`);
      this.seats = data.seats;
      this.currentShow = data.show;
      if (clearSelection) {
        this.selectedSeats = [];
      } else {
        this.selectedSeats = this.selectedSeats.filter((seatId) => {
          const seat = this.seats.find((item) => item.id === seatId);
          return seat?.status === "available";
        });
      }
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
        this.go("login");
        return;
      }
      this.busy = true;
      this.notice = "";
      try {
        const result = await fetchJson("/api/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...this.authHeaders() },
          body: JSON.stringify({ showId: this.selectedShowId, seats: this.selectedSeats }),
        });
        this.currentOrder = result.order;
        this.notice = `订单已创建，金额 ￥${result.order.amount}，座位锁定 ${result.lockTtlSeconds} 秒。`;
        await this.loadSeats(false);
        await this.refreshStats();
        await this.loadMyOrders();
      } catch (error) {
        this.notice = `下单失败：${error.message}`;
      } finally {
        this.busy = false;
      }
    },
    async payOrder() {
      if (!this.currentOrder) return;
      await this.payExistingOrder(this.currentOrder);
    },
    async payExistingOrder(order) {
      this.busy = true;
      this.notice = "";
      try {
        const result = await fetchJson(`/api/orders/${order.id}/pay`, { method: "POST", headers: this.authHeaders() });
        this.currentOrder = result.order;
        this.notice = `支付成功：${result.order.movieTitle}，${result.order.seats.join(", ")}。`;
        this.selectedSeats = [];
        await Promise.all([this.loadSeats(false), this.refreshStats(), this.loadMyOrders()]);
      } catch (error) {
        this.notice = `支付失败：${error.message}`;
      } finally {
        this.busy = false;
      }
    },
    async refreshStats() {
      this.stats = await fetchJson("/api/admin/stats");
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

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || response.statusText);
  return body;
}
