/*
一、Nacos部署与启动步骤
  1. 下载 Nacos 服务端
  下载地址：https://github.com/alibaba/nacos/releases
  选择版本：nacos-server-2.5.1.zip
  解压到本地目录，比如：D:\nacos-server-2.5.1
  2. 关闭鉴权（如果登录需要账户和密码）
  打开配置文件：nacos/conf/application.properties
  找到 nacos.core.auth.enabled=true，改为：
  nacos.core.auth.enabled=false
  保存文件。
  3. 启动 Nacos 服务
  进入 nacos/bin 目录
  执行单机模式启动命令：
  startup.cmd -m standalone
  看到 Nacos started successfully in stand alone mode 说明启动成功。
  4. 访问 Nacos 控制台
  浏览器访问：http://localhost:8848/nacos
  无需登录即可进入，默认账号密码 nacos/nacos（已关闭鉴权）
  5. 创建配置
  进入「配置管理」→「配置列表」→「+」
  填写信息：
  Data ID：cinema-ticket-config.json
  Group：DEFAULT_GROUP
  配置格式：JSON
  配置内容：
  json
  {
    "priceRate": 0.8,
    "globalDiscount": 1,
    "vipExtraDiscount": 0.9,
    "maxTicketLimit": 4
  }
  点击「发布」保存。
二、功能操作演示流程
1. 启动服务
启动 Nacos（单机模式）
启动 Node 项目：node src/server.js
启动前端服务，登录管理员后台
2. 前端 → Nacos 同步
在「Nacos 全局票价倍率配置」输入框修改倍率（如 0.7）
点击「应用配置」
查看 Nacos 控制台配置，priceRate 已同步更新为 0.7
3. Nacos → 前端同步
在 Nacos 控制台修改 priceRate 为 0.5，点击「发布」
前端页面每 5 秒自动轮询，输入框和优惠价会同步更新为 0.5
*/ 


const axios = require('axios');

const NACOS_URL = 'http://127.0.0.1:8848/nacos/v1/cs/configs';
const DATA_ID = 'cinema-ticket-config.json';
const GROUP = 'DEFAULT_GROUP';

let globalConfig = {
  priceRate: 1,
  globalDiscount: 1,
  vipExtraDiscount: 0.9,
  maxTicketLimit: 4
};

async function getRemoteConfig() {
  try {
    const res = await axios.get(NACOS_URL, {
      params: { dataId: DATA_ID, group: GROUP },
      timeout: 3000
    });
    return res.data;
  } catch (err) {
    console.error("请求 Nacos 接口失败：", err.message);
    return null;
  }
}

async function setRemoteConfig(content) {
  try {
    await axios.post(NACOS_URL, null, {
      params: { dataId: DATA_ID, group: GROUP, content: content },
      timeout: 3000
    });
    return true;
  } catch (err) {
    console.error("发布配置失败：", err.message);
    return false;
  }
}

async function init() {
  const remoteCfg = await getRemoteConfig();
  if (remoteCfg) {
    globalConfig = remoteCfg;
    console.log("✅ 成功加载 Nacos 远程配置：", globalConfig);
  } else {
    console.log("⚠️ 无法连接 Nacos，使用本地默认配置");
  }
}
init();

module.exports = {
  getConfig: () => ({ ...globalConfig }),

  publishConfig: async (newConfig) => {
    const merged = { ...globalConfig, ...newConfig };
    const content = JSON.stringify(merged, null, 2);
    const ok = await setRemoteConfig(content);
    if (ok) globalConfig = merged;
    return ok;
  },

  refreshConfig: async () => {
    const cfg = await getRemoteConfig();
    if (cfg) globalConfig = cfg;
    return globalConfig;
  },

  onConfigUpdate: () => {}
};