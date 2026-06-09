import { apiFetch, authHeaders, getSession, logout } from "../common.js";
const { createApp } = Vue;

createApp({
  data() {
    return {
     
      session: getSession(),
     
      logout,
     
      dashboard: null,
     
      priceDrafts: {},
     
      notice: "",
   
    };
  },
  computed: {
    isAdmin() {
      return this.session?.user?.role === "ADMIN";
    }
  },
  async mounted() {
    await this.loadDashboard();
  },
  methods: {
    // 刷新后台：加载仓库数据
    async loadDashboard() {
      if (!this.isAdmin) return;
      this.notice = "正在从从库加载数据...";
      try {
        // 请求后端接口
        const res = await apiFetch("/api/admin/dashboard", { headers: authHeaders() });
        this.dashboard = res;
        //彻底清空旧数据
        this.priceDrafts = {};
        res.shows.forEach(show => {
          this.priceDrafts[show.id] = Number(show.price);
          console.log(`场次ID:${show.id} | 影片:${show.movieTitle} | 后端价格:${show.price} | 已写入priceDrafts`);
        });
        this.notice = "数据加载完成（数据源：从库）";
      } catch (err) {
        this.notice = "加载数据失败";
        console.error("加载仪表盘异常：", err);
      }
    },

    // 提交调价：写入主库
    async updatePrice(show) {
      try {
        const price = this.priceDrafts[show.id];
        await apiFetch(`/api/admin/shows/${show.id}/price`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ price })
        });
        // 同步完成自动刷新从库数据
        await this.loadDashboard();
      } catch (error) {
        this.notice = `调价失败：${error.message}`;
        console.error("调价出错：", error);
      }
    },

    // 新增：标准写法的 Nacos 方法（无任何波浪线）
    async updatePriceRate() {
      const priceRate = Number(document.getElementById('priceRate').value);
      try {
        const res = await apiFetch("/api/admin/nacos-price-rate", {
          method: "PATCH",
          headers: authHeaders(),
          body: JSON.stringify({ priceRate })
        });
        document.getElementById('rateTip').innerText = "✅ 配置生效";
        // 关键：用 this. 调用组件内的刷新方法
        await this.loadDashboard();
      } catch (err) {
        document.getElementById('rateTip').innerText = "❌ 配置失败";
      }
    }
  
  }

    
}).mount("#app");