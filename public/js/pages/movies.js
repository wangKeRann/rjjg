import { apiFetch, getSession, logout, lowestPrice, posterStyle } from "../common.js";

const { createApp } = Vue;

createApp({
  data() {
    return {
      session: getSession(),
      logout,
      movies: [],
      cinemas: [],
      searchQuery: "",
      searchResult: null,
      sortMode: "heat",
      filters: { city: "上海", date: "今天 06-04", cinema: "" },
      isLoading: false,
      searchError: null,
      searchTimeout: null,
      moviesFromCache: false,
      searchFromCache: false,
    };
  },
  computed: {
    sortedMovies() {
      const rows = [...this.movies];
      if (this.sortMode === "rating") return rows.sort((a, b) => b.rating - a.rating);
      if (this.sortMode === "price") return rows.sort((a, b) => lowestPrice(a) - lowestPrice(b));
      return rows.sort((a, b) => b.heat - a.heat);
    },
    displayedMovies() {
      return this.searchResult?.movies?.length ? this.searchResult.movies : this.sortedMovies;
    },
    showSearchResults() {
      return Boolean(this.searchResult && this.searchQuery.trim());
    },
    searchSummary() {
      if (!this.searchResult || !this.searchQuery.trim()) return "";
      const movieCount = this.searchResult.movies?.length || 0;
      const cinemaCount = this.searchResult.cinemas?.length || 0;
      const cacheHint = this.searchFromCache ? "（Redis 缓存命中）" : "";
      return `找到 ${movieCount} 部影片和 ${cinemaCount} 家影院${cacheHint}`;
    },
  },
  async mounted() {
    await Promise.all([this.loadMovies(), this.loadCinemas()]);
  },
  methods: {
    posterStyle,
    async loadMovies() {
      try {
        const payload = await apiFetch("/api/movies");
        this.movies = payload.movies;
        this.moviesFromCache = Boolean(payload.cached);
      } catch (error) {
        console.error("加载影片失败:", error);
      }
    },
    async loadCinemas() {
      try {
        this.cinemas = (await apiFetch("/api/cinemas")).cinemas;
      } catch (error) {
        console.error("加载影院失败:", error);
      }
    },
    async runSearch() {
      this.searchError = null;
      this.searchFromCache = false;

      if (!this.searchQuery.trim()) {
        this.searchResult = null;
        return;
      }

      this.isLoading = true;
      try {
        const url = `/api/search?q=${encodeURIComponent(this.searchQuery.trim())}`;
        const payload = await apiFetch(url);
        this.searchResult = payload;
        this.searchFromCache = Boolean(payload.cached);
      } catch (error) {
        console.error("搜索失败:", error);
        this.searchError = `搜索失败: ${error.message}`;
        this.searchResult = null;
      } finally {
        this.isLoading = false;
      }
    },
    clearSearch() {
      this.searchQuery = "";
      this.searchResult = null;
      this.searchError = null;
      this.searchFromCache = false;
    },
    onSearchInput() {
      if (this.searchTimeout) {
        clearTimeout(this.searchTimeout);
      }

      this.searchTimeout = setTimeout(() => {
        if (this.searchQuery.trim().length >= 2) {
          this.runSearch();
        } else if (this.searchQuery.trim().length === 0) {
          this.clearSearch();
        }
      }, 300);
    },
    book(movie) {
      const showId = movie.shows[0]?.id || "";
      location.href = `/booking.html${showId ? `?showId=${showId}` : ""}`;
    },
  },
}).mount("#app");
