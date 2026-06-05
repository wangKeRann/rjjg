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
  },
  async mounted() {
    await Promise.all([this.loadMovies(), this.loadCinemas()]);
  },
  methods: {
    posterStyle,
    async loadMovies() {
      this.movies = (await apiFetch("/api/movies")).movies;
    },
    async loadCinemas() {
      this.cinemas = (await apiFetch("/api/cinemas")).cinemas;
    },
    async runSearch() {
      if (!this.searchQuery.trim()) {
        this.searchResult = null;
        return;
      }
      this.searchResult = await apiFetch(`/api/search?q=${encodeURIComponent(this.searchQuery.trim())}`);
    },
    book(movie) {
      const showId = movie.shows[0]?.id || "";
      location.href = `/booking.html${showId ? `?showId=${showId}` : ""}`;
    },
  },
}).mount("#app");
