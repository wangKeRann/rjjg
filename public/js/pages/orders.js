import { apiFetch, authHeaders, getSession, logout } from "../common.js";

const { createApp } = Vue;

createApp({
  data() {
    return { 
      session: getSession(), 
      logout, 
      orders: [], 
      notice: "",
      noticeType: "info",
      refreshTimer: null
    };
  },
  computed: {
    isCustomer() {
      return this.session?.user?.role === "CUSTOMER";
    },
  },
  async mounted() {
    await this.loadOrders();
    
    // 每30秒自动刷新订单列表
    this.refreshTimer = setInterval(() => {
      if (this.isCustomer) {
        this.loadOrders();
      }
    }, 30000);
  },
  beforeUnmount() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }
  },
  methods: {
    // 加载订单列表
    async loadOrders() {
      if (!this.isCustomer) return;
      try {
        const data = await apiFetch("/api/my/orders", { headers: authHeaders() });
        this.orders = data.orders;
      } catch (error) {
        console.error("加载订单失败:", error);
      }
    },
    
    // 通用取消订单方法（抽取公共逻辑）
    async cancelOrderById(orderId, reason, showConfirm = false, confirmMessage = "") {
      if (showConfirm && confirmMessage) {
        if (!confirm(confirmMessage)) {
          return false;
        }
      }
      
      try {
        const response = await fetch(`/api/orders/${orderId}/cancel`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ reason })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
          this.notice = `取消失败：${data.error || "未知错误"}`;
          this.noticeType = "error";
          return false;
        }
        
        return true;
        
      } catch (error) {
        console.error("取消订单异常:", error);
        this.notice = `取消失败：${error.message}`;
        this.noticeType = "error";
        return false;
      }
    },
    
    // 用户主动取消订单（有确认弹窗）
    async cancelOrder(order) {
      const confirmMessage = `确定要取消订单吗？\n影片：${order.movieTitle}\n座位：${order.seats.join(", ")}\n金额：￥${order.amount}`;
      
      const success = await this.cancelOrderById(order.id, "USER_CANCELLED", true, confirmMessage);
      
      if (success) {
        this.notice = "订单已取消，座位已释放";
        this.noticeType = "success";
        await this.loadOrders();
        
        setTimeout(() => {
          if (this.notice === "订单已取消，座位已释放") {
            this.notice = "";
          }
        }, 3000);
      }
    },
    
    // 超时自动取消订单（无确认弹窗，静默执行）
    async cancelExpiredOrder(order) {
      const success = await this.cancelOrderById(order.id, "ORDER_EXPIRED", false);
      if (success) {
        await this.loadOrders();
      }
    },
    
    // 支付订单
    async pay(order) {
      if (new Date(order.expiresAt) <= new Date()) {
        this.notice = "订单已超时，正在取消...";
        this.noticeType = "error";
        await this.cancelExpiredOrder(order);
        return;
      }
      
      try {
        const response = await fetch(`/api/orders/${order.id}/pay`, {
          method: "POST",
          headers: authHeaders(),
        });
        
        const data = await response.json();
        
        if (!response.ok) {
          if (response.status === 409 && data.error === "ORDER_EXPIRED") {
            this.notice = data.message || "订单已超时，已被自动取消";
            this.noticeType = "error";
            await this.loadOrders();
          } else if (response.status === 409 && data.error === "ORDER_NOT_PAYABLE") {
            this.notice = `订单状态已变更：${data.status}`;
            this.noticeType = "error";
            await this.loadOrders();
          } else {
            this.notice = `支付失败：${data.error || data.message || "未知错误"}`;
            this.noticeType = "error";
          }
          return;
        }
        
        this.notice = "支付成功！";
        this.noticeType = "success";
        await this.loadOrders();
        
        setTimeout(() => {
          if (this.notice === "支付成功！") {
            this.notice = "";
          }
        }, 3000);
        
      } catch (error) {
        console.error("支付请求异常:", error);
        this.notice = `支付失败：${error.message}`;
        this.noticeType = "error";
      }
    },
    
    // 获取订单状态样式
    getOrderStatusClass(status) {
      switch(status) {
        case 'PAID': return 'status-paid';
        case 'CANCELLED': return 'status-cancelled';
        case 'PENDING_PAYMENT': return 'status-pending';
        default: return '';
      }
    },
    
    // 是否显示支付按钮（待支付且未超时）
    showPayButton(order) {
      if (order.status !== 'PENDING_PAYMENT') return false;
      return new Date(order.expiresAt) > new Date();
    },
    
    // 是否显示取消按钮（待支付状态就显示，超时后靠定时器刷新会消失）
    showCancelButton(order) {
      return order.status === 'PENDING_PAYMENT';
    },
    
    // 获取超时剩余时间显示
    getExpiryDisplay(order) {
      if (order.status !== 'PENDING_PAYMENT') return '';
      const remaining = new Date(order.expiresAt) - new Date();
      if (remaining <= 0) return '已超时';
      const seconds = Math.floor(remaining / 1000);
      const minutes = Math.floor(seconds / 60);
      const secs = seconds % 60;
      if (minutes > 0) {
        return `${minutes}分${secs}秒`;
      }
      return `${secs}秒`;
    }
  },
}).mount("#app");