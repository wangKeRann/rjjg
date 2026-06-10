import { apiFetch, authHeaders, getSession, logout } from "../common.js";
const { createApp } = Vue;

createApp({
  data() {
    return {
      session: {},
      logout,
      dashboard: null,
      priceDrafts: {},
      notice: "",
      configTimer: null
    };
  },
  computed: {
    isAdmin() {
      return this.session?.user?.role === "ADMIN";
    }
  },
  async mounted() {
    this.session = getSession();
    if (this.isAdmin) {
      await this.refreshPriceRate();
      await this.loadDashboard();
      this.configTimer = setInterval(() => {
        console.log("⏱️ 执行轮询，拉取最新倍率...");
        this.refreshPriceRate();
      }, 5000);
    }
  },
  beforeUnmount() {
    if (this.configTimer) {
      clearInterval(this.configTimer);
    }
  },
  methods: {
    async refreshPriceRate() {
      try {
        const config = await apiFetch("/api/admin/nacos-config", { headers: authHeaders() });
        console.log("📥 从后端拉到的配置：", config);
        const rateInput = document.getElementById('priceRate');
        if (rateInput && config.priceRate != null) {
          rateInput.value = config.priceRate;
          rateInput.dispatchEvent(new Event('input'));
          console.log("✅ 前端输入框已更新为：", config.priceRate);
          // 更新倍率后，重新加载一次价格列表
          await this.loadDashboard();
        }
      } catch (e) {
        console.error("❌ 读取配置失败", e);
      }
    },

    async loadDashboard() {
      if (!this.isAdmin) return;
      this.notice = "正在从从库加载数据...";
      try {
        const res = await apiFetch("/api/admin/dashboard", { headers: authHeaders() });
        this.dashboard = res;
        this.priceDrafts = {};
        res.shows.forEach(show => {
          this.priceDrafts[show.id] = Number(show.price);
        });
        this.notice = "数据加载完成（数据源：从库）";
      } catch (err) {
        this.notice = "加载数据失败";
        console.error("加载仪表盘异常：", err);
      }
    },

    async updatePrice(show) {
      try {
        const price = this.priceDrafts[show.id];
        await apiFetch(`/api/admin/shows/${show.id}/price`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ price })
        });
        await this.loadDashboard();
      } catch (error) {
        this.notice = `调价失败：${error.message}`;
        console.error("调价出错：", error);
      }
    },

    async updatePriceRate() {
      const priceRateInput = document.getElementById('priceRate');
      const rateTip = document.getElementById('rateTip');
      if (!priceRateInput || !rateTip) return;

      const priceRate = Number(priceRateInput.value);
      if (isNaN(priceRate) || priceRate < 0.1 || priceRate > 2) {
        rateTip.innerText = " 倍率需在 0.1-2 之间";
        return;
      }

      try {
        await apiFetch("/api/admin/nacos-price-rate", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...authHeaders()
          },
          body: JSON.stringify({ priceRate })
        });
        rateTip.innerText = " 配置生效";
        await this.loadDashboard();
      } catch (err) {
        rateTip.innerText = " 配置失败：" + err.message;
        console.error("配置错误：", err);
      }
    }
  }
}).mount("#app");