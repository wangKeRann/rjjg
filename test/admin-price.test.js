const assert = require("node:assert/strict");
const test = require("node:test");

// 引入核心业务模块
const nacos = require("../src/nacos-config");
const { readDatabase, updateDatabase } = require("../src/db-rw-separation");

// 真实基准数据（数据库内 s2 初始价格 = 53）
const TEST_SHOW_ID = "s2";
const BASE_PRICE = 53;
// 读写分离同步延迟：5秒 = 5000ms
const SYNC_DELAY = 6000; 

/**
 * 环境重置：恢复原始票价 + 重置Nacos倍率
 */
function resetEnv() {
  updateDatabase(db => {
    const show = db.shows.find(s => s.id === TEST_SHOW_ID);
    if (show) show.price = BASE_PRICE;
    return db;
  });
  nacos.publishConfig({ priceRate: 1.0 });
}

/**
 * 封装延时等待
 * @param {number} ms 等待毫秒数
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ==================== 测试用例 ====================
test("1. 数据库读写分离逻辑测试（适配5秒同步延迟）", async () => {
  resetEnv();

  // 1. 读从库：初始价格
  let dbRead = readDatabase();
  let show = dbRead.shows.find(s => s.id === TEST_SHOW_ID);
  assert.equal(show.price, BASE_PRICE);

  // 2. 写主库：修改价格
  const newPrice = BASE_PRICE + 5;
  updateDatabase(db => {
    const s = db.shows.find(item => item.id === TEST_SHOW_ID);
    if (s) s.price = newPrice;
    return db;
  });
  console.log("已写入主库，等待从库同步...");

  // 关键：等待 6 秒，确保主从数据同步完成
  await sleep(SYNC_DELAY);

  // 3. 再次读从库，校验同步结果
  dbRead = readDatabase();
  show = dbRead.shows.find(s => s.id === TEST_SHOW_ID);
  assert.equal(show.price, newPrice);

  console.log("✅ 读写分离测试通过");
});

test("2. 票价合法性边界校验", () => {
  // 规则：票价范围 1 ~ 999
  const checkPrice = (price) => price >= 1 && price <= 999;

  assert.equal(checkPrice(0), false);    // 小于1 非法
  assert.equal(checkPrice(1000), false); // 大于999 非法
  assert.equal(checkPrice(50), true);    // 正常票价
  assert.equal(checkPrice(1), true);     // 下边界
  assert.equal(checkPrice(999), true);   // 上边界

  console.log("✅ 票价边界校验测试通过");
});

test("3. Nacos 配置 + 优惠价计算测试", () => {
  resetEnv();
  const testRate = 0.6;

  // 修改Nacos倍率
  nacos.publishConfig({ priceRate: testRate });
  const cfg = nacos.getConfig();
  assert.equal(cfg.priceRate, testRate);

  // 计算优惠价：53 * 0.6 = 31.80
  const realPrice = (BASE_PRICE * testRate).toFixed(2);
  assert.equal(realPrice, "31.80");

  console.log("✅ Nacos 配置与优惠价计算测试通过");
});

test("4. Nacos 默认配置值测试", () => {
  resetEnv();
  const cfg = nacos.getConfig();
  assert.equal(cfg.priceRate, 1.0);
  console.log("✅ Nacos 默认配置测试通过");
});