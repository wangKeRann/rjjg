const crypto = require("node:crypto");
const { hashPassword, readDatabase } = require("./database");

const sessions = new Map();
const SESSION_TTL_MS = 1000 * 60 * 60 * 8;

function verifyLogin(login, password, role) {
  const db = readDatabase();
  const user = db.users.find((item) => item.login === login && item.role === role);
  if (!user) return null;

  const candidate = hashPassword(password, user.passwordSalt);
  const ok = crypto.timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(user.passwordHash, "hex"));
  return ok ? publicUser(user) : null;
}

function issueSession(user) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, {
    user,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  return token;
}

function getSession(token) {
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function revokeSession(token) {
  sessions.delete(token);
}

function publicUser(user) {
  return {
    id: user.id,
    role: user.role,
    displayName: user.displayName,
    login: user.login,
  };
}

function requireAuth(roles = []) {
  return (req, res, next) => {
    const auth = req.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const session = getSession(token);
    if (!session) {
      res.status(401).json({ error: "UNAUTHENTICATED", message: "请先登录" });
      return;
    }
    if (roles.length && !roles.includes(session.user.role)) {
      res.status(403).json({ error: "FORBIDDEN", message: "权限不足" });
      return;
    }
    req.user = session.user;
    req.token = token;
    next();
  };
}

module.exports = {
  issueSession,
  requireAuth,
  revokeSession,
  verifyLogin,
};
