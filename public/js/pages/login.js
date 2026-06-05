import { apiFetch, saveSession } from "../common.js";

const { createApp } = Vue;

createApp({
  data() {
    return {
      login: "",
      password: "",
      notice: "",
      busy: false,
      pupil: { x: 0, y: 0 },
    };
  },
  computed: {
    detectedRole() {
      return this.login.toLowerCase() === "admin" ? "ADMIN" : "CUSTOMER";
    },
    eyeStyle() {
      return {
        transform: `translate(${this.pupil.x}px, ${this.pupil.y}px)`,
      };
    },
  },
  methods: {
    trackMouse(event) {
      const rect = event.currentTarget.getBoundingClientRect();
      const centerX = rect.left + rect.width * 0.42;
      const centerY = rect.top + rect.height * 0.48;
      const dx = Math.max(-1, Math.min(1, (event.clientX - centerX) / 260));
      const dy = Math.max(-1, Math.min(1, (event.clientY - centerY) / 180));
      this.pupil = { x: Math.round(dx * 8), y: Math.round(dy * 7) };
    },
    resetCat() {
      this.pupil = { x: 0, y: 0 };
    },
    async submit() {
      this.busy = true;
      this.notice = "";
      try {
        const portal = this.detectedRole === "ADMIN" ? "admin" : "customer";
        const result = await apiFetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ portal, login: this.login, password: this.password }),
        });
        saveSession(result);
        location.href = result.portal === "admin" ? "/admin-shows.html" : "/movies.html";
      } catch (error) {
        this.notice = `登录失败：${error.message}`;
      } finally {
        this.busy = false;
      }
    },
  },
}).mount("#app");
