const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const DB_PATH = path.join(__dirname, "..", "data", "cinema-db.json");
const ROWS = ["A", "B", "C", "D", "E", "F"];
const COLS = [1, 2, 3, 4, 5, 6, 7, 8];

function buildSeats() {
  return ROWS.flatMap((row) => COLS.map((col) => `${row}${col}`));
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(String(password), salt, 120000, 32, "sha256").toString("hex");
}

function ensureDatabase() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(DB_PATH)) {
    writeDatabase(seedDatabase());
    return;
  }

  const db = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  const legacyDemoLogin = "x" + "x";
  const demoUser = db.users.find((user) => user.id === "u1002" || user.login === legacyDemoLogin || user.login === "user");
  const salt = "customer-user-demo-salt";
  if (demoUser) {
    demoUser.id = "u1002";
    demoUser.role = "CUSTOMER";
    demoUser.displayName = "普通用户";
    demoUser.login = "user";
    demoUser.passwordSalt = salt;
    demoUser.passwordHash = hashPassword("user123", salt);
    db.meta.updatedAt = new Date().toISOString();
    writeDatabase(db);
  } else {
    db.users.push({
      id: "u1002",
      role: "CUSTOMER",
      displayName: "普通用户",
      login: "user",
      passwordSalt: salt,
      passwordHash: hashPassword("user123", salt),
    });
    db.meta.updatedAt = new Date().toISOString();
    writeDatabase(db);
  }
}

function readDatabase() {
  ensureDatabase();
  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}

function writeDatabase(db) {
  const tmp = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(db, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, DB_PATH);
}

function updateDatabase(mutator) {
  const db = readDatabase();
  const result = mutator(db);
  db.meta.updatedAt = new Date().toISOString();
  writeDatabase(db);
  return result;
}

function resetDatabase() {
  writeDatabase(seedDatabase());
}

function seedDatabase() {
  const customerSalt = "customer-demo-salt";
  const adminSalt = "admin-demo-salt";
  const seats = buildSeats();
  return {
    meta: {
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      source: "local persistent database",
    },
    users: [
      {
        id: "u1001",
        role: "CUSTOMER",
        displayName: "演示用户",
        login: "13800000000",
        passwordSalt: customerSalt,
        passwordHash: hashPassword("123456", customerSalt),
      },
      {
        id: "u1002",
        role: "CUSTOMER",
        displayName: "普通用户",
        login: "user",
        passwordSalt: "customer-user-demo-salt",
        passwordHash: hashPassword("user123", "customer-user-demo-salt"),
      },
      {
        id: "a1001",
        role: "ADMIN",
        displayName: "影院管理员",
        login: "admin",
        passwordSalt: adminSalt,
        passwordHash: hashPassword("admin123", adminSalt),
      },
    ],
    movies: [
      {
        id: "m1",
        title: "星际回声",
        genre: "科幻 / 冒险",
        duration: 126,
        rating: 9.3,
        heat: 98243,
        boxOffice: "3.12亿",
        releaseDate: "2026-05-28",
        language: "国语 / 英语",
        director: "林远",
        cast: ["周屿", "陈星岚", "罗川"],
        tagline: "穿过虫洞之后，回家的声音比光更快。",
        synopsis: "近未来的深空救援队收到来自十年前的地球信号，必须在燃料耗尽前完成一次跨星际返航。",
        tags: ["热映", "IMAX", "杜比全景声", "团队观影"],
        posterTone: "#186b7a",
        accent: "#36d6c7",
      },
      {
        id: "m2",
        title: "午夜列车",
        genre: "悬疑 / 剧情",
        duration: 109,
        rating: 8.8,
        heat: 70310,
        boxOffice: "1.06亿",
        releaseDate: "2026-06-01",
        language: "国语",
        director: "沈嘉木",
        cast: ["韩知遥", "陆北辰", "姜禾"],
        tagline: "每一站都有人下车，只有真相还在车上。",
        synopsis: "一列夜间城际列车上发生离奇失踪，乘客身份与旧案线索逐渐交织，倒计时中无人能够置身事外。",
        tags: ["悬疑", "口碑佳片", "黄金场", "新片"],
        posterTone: "#8d2d3a",
        accent: "#ff8a7a",
      },
      {
        id: "m3",
        title: "海边来信",
        genre: "爱情 / 家庭",
        duration: 118,
        rating: 9.1,
        heat: 56498,
        boxOffice: "8420万",
        releaseDate: "2026-05-20",
        language: "国语",
        director: "许珊",
        cast: ["林乔", "宋以安", "叶书白"],
        tagline: "有些告别，等海风替我们说完。",
        synopsis: "多年未归的女儿回到海边小城，在母亲留下的信件中重新认识家庭、爱情和自己的人生选择。",
        tags: ["高分", "温情", "VIP厅", "约会推荐"],
        posterTone: "#ba7b2f",
        accent: "#f5c16c",
      },
      {
        id: "m4",
        title: "云端漫游指南",
        genre: "动画 / 奇幻",
        duration: 97,
        rating: 8.9,
        heat: 43620,
        boxOffice: "6210万",
        releaseDate: "2026-06-03",
        language: "国语",
        director: "南枝",
        cast: ["配音：苏晓", "配音：明澈", "配音：阿洛"],
        tagline: "迷路的孩子，总会在云里找到地图。",
        synopsis: "一个擅长画地图的小孩意外进入云端城市，与会唱歌的导航精灵一起修复即将消失的天空路线。",
        tags: ["亲子", "动画", "低价场", "周末热卖"],
        posterTone: "#4267b2",
        accent: "#91caff",
      },
    ],
    shows: [
      {
        id: "s1",
        movieId: "m1",
        startsAt: "2026-06-04 19:30",
        price: 58,
        hall: "IMAX 1号厅",
        cinema: "云上影城 · 星环店",
        address: "星环广场 6F",
        distance: "1.2km",
        format: "IMAX 3D",
        language: "国语配音",
        serviceTags: ["可改签", "停车券", "取票机", "会员积分"],
        seats,
        sold: ["A1", "A2", "C5", "D6", "E7"],
      },
      {
        id: "s2",
        movieId: "m1",
        startsAt: "2026-06-04 22:10",
        price: 52,
        hall: "2号厅",
        cinema: "云上影城 · 滨江店",
        address: "滨江天地 B1",
        distance: "3.8km",
        format: "CINITY",
        language: "原版字幕",
        serviceTags: ["夜场优惠", "小食套餐", "情侣座", "无接触取票"],
        seats,
        sold: ["B3", "B4", "F8"],
      },
      {
        id: "s3",
        movieId: "m2",
        startsAt: "2026-06-04 20:00",
        price: 45,
        hall: "3号厅",
        cinema: "城市幕布影城 · 中心店",
        address: "中心商业街 4F",
        distance: "2.4km",
        format: "数字 2D",
        language: "国语",
        serviceTags: ["可退票", "学生优惠", "扫码入场", "饮品券"],
        seats,
        sold: ["A8", "C1", "C2", "D4"],
      },
      {
        id: "s4",
        movieId: "m3",
        startsAt: "2026-06-04 21:20",
        price: 68,
        hall: "VIP厅",
        cinema: "棕榈影院 · 海湾店",
        address: "海湾生活广场 3F",
        distance: "4.1km",
        format: "VIP 2D",
        language: "国语",
        serviceTags: ["躺椅厅", "包厢服务", "免费茶饮", "可改签"],
        seats,
        sold: ["B6", "D2", "E3", "F1", "F2"],
      },
      {
        id: "s5",
        movieId: "m4",
        startsAt: "2026-06-04 18:40",
        price: 39,
        hall: "亲子厅",
        cinema: "城市幕布影城 · 亲子店",
        address: "绿洲商场 5F",
        distance: "2.9km",
        format: "数字 2D",
        language: "国语",
        serviceTags: ["儿童坐垫", "亲子套餐", "半价儿童票", "扫码入场"],
        seats,
        sold: ["A3", "A4", "B5", "C7"],
      },
    ],
    orders: [],
  };
}

module.exports = {
  COLS,
  ROWS,
  DB_PATH,
  hashPassword,
  readDatabase,
  resetDatabase,
  updateDatabase,
};
