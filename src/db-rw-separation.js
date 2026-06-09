const fs = require('fs');
const path = require('path');

const MASTER_FILE = path.resolve(__dirname, '../data/cinema-db.json');
const SLAVE_FILE = path.resolve(__dirname, '../data/cinema-db-slave.json');

//安全读取JSON文件
function safeRead(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    console.error(`[ERROR] 读取文件失败: ${filePath}`, e);
    return { movies: [], shows: [], orders: [] };
  }
}

// 读取从库
function readDatabase() {
  console.log("正在读取从库cinema-db-slave.json");
  const data = safeRead(SLAVE_FILE);
  return data;
}

//写入主库，异步同步至从库
function updateDatabase(updater) {
  console.log("正在写入主库cinema-db.json");

  const db = safeRead(MASTER_FILE);
  updater(db);
  fs.writeFileSync(MASTER_FILE, JSON.stringify(db, null, 2));

  // 模拟5秒主从同步延迟
  setTimeout(() => {
    fs.writeFileSync(SLAVE_FILE, JSON.stringify(db, null, 2));
    console.log("\n主从同步完成，数据已写入从库");
  }, 5000);

  return db;
}

module.exports = { readDatabase, updateDatabase };