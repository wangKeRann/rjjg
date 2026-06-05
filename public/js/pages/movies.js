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
      console.log("计算displayedMovies...");
      console.log("searchResult存在:", !!this.searchResult);
      console.log("searchResult.movies数量:", this.searchResult?.movies?.length || 0);
      console.log("sortedMovies数量:", this.sortedMovies.length);
      
      const result = this.searchResult?.movies?.length ? this.searchResult.movies : this.sortedMovies;
      console.log("displayedMovies返回数量:", result.length);
      return result;
    },
    showSearchResults() {
      const result = this.searchResult && this.searchQuery.trim();
      console.log("showSearchResults:", result);
      return result;
    },
    searchSummary() {
      if (!this.searchResult || !this.searchQuery.trim()) return "";
      const movieCount = this.searchResult.movies?.length || 0;
      const cinemaCount = this.searchResult.cinemas?.length || 0;
      return `找到 ${movieCount} 部影片和 ${cinemaCount} 家影院`;
    }
  },
  async mounted() {
    await Promise.all([this.loadMovies(), this.loadCinemas()]);
  },
  methods: {
    posterStyle,
    async loadMovies() {
      try {
        this.movies = (await apiFetch("/api/movies")).movies;
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
      
      console.log("runSearch被调用，搜索词:", this.searchQuery);
      
      if (!this.searchQuery.trim()) {
        console.log("搜索词为空，清除结果");
        this.searchResult = null;
        return;
      }
      
      this.isLoading = true;
      console.log("设置isLoading为true");
      
      try {
        console.log("开始搜索:", this.searchQuery);
        const url = `/api/search?q=${encodeURIComponent(this.searchQuery.trim())}`;
        console.log("API URL:", url);
        
        this.searchResult = await apiFetch(url);
        console.log("搜索成功，结果:", this.searchResult);
        console.log("找到影片数量:", this.searchResult.movies?.length || 0);
        console.log("找到影院数量:", this.searchResult.cinemas?.length || 0);
      } catch (error) {
        console.error("搜索失败:", error);
        this.searchError = `搜索失败: ${error.message}`;
        this.searchResult = null;
      } finally {
        this.isLoading = false;
        console.log("设置isLoading为false");
      }
    },
    clearSearch() {
      this.searchQuery = "";
      this.searchResult = null;
      this.searchError = null;
    },
    
    // 搜索输入处理，添加防抖
    onSearchInput(event) {
      console.log("搜索输入变化:", event.target.value);
      // 简单防抖，300ms后执行搜索
      if (this.searchTimeout) {
        clearTimeout(this.searchTimeout);
      }
      
      this.searchTimeout = setTimeout(() => {
        if (this.searchQuery.trim().length >= 2) { // 至少2个字符才搜索
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
