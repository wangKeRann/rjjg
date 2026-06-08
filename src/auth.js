const crypto = require("node:crypto");
const { hashPassword, readDatabase } = require("./database");

const TOKEN_TTL_SECONDS = Number(process.env.JWT_TTL_SECONDS || 60 * 60 * 8);
const JWT_SECRET = process.env.JWT_SECRET || "cinemaos-dev-secret-change-me";
const JWT_ISSUER = "cinemaos";

const ROLE_PERMISSIONS = Object.freeze({
  CUSTOMER: Object.freeze([
    "movie:read",
    "show:read",
    "order:create",
    "order:read:self",
    "order:pay:self",
    "order:cancel:self",
  ]),
  ADMIN: Object.freeze([
    "movie:read",
    "show:read",
    "admin:dashboard",
    "show:price:update",
    "order:read:any",
    "order:pay:any",
    "order:cancel:any",
    "cache:manage",
    "ops:view",
  ]),
});

const revokedTokenIds = new Map();

function verifyLogin(login, password, role) {
  const db = readDatabase();
  const user = db.users.find((item) => item.login === login && item.role === role);
  if (!user) return null;

  const candidate = hashPassword(password, user.passwordSalt);
  const ok = crypto.timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(user.passwordHash, "hex"));
  return ok ? publicUser(user) : null;
}

function issueSession(user) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: JWT_ISSUER,
    sub: user.id,
    jti: crypto.randomUUID(),
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
    login: user.login,
    displayName: user.displayName,
    role: user.role,
    permissions: permissionsForRole(user.role),
  };
  return signJwt(payload);
}

function getSession(token) {
  const payload = verifyJwt(token);
  if (!payload) return null;

  const db = readDatabase();
  const user = db.users.find((item) => item.id === payload.sub && item.role === payload.role);
  if (!user) return null;

  return {
    user: publicUser(user),
    permissions: permissionsForRole(user.role),
    claims: payload,
  };
}

function revokeSession(token) {
  const payload = verifyJwt(token, { ignoreRevocation: true });
  if (!payload?.jti || !payload.exp) return;
  revokedTokenIds.set(payload.jti, payload.exp);
  purgeRevokedTokens();
}

function publicUser(user) {
  return {
    id: user.id,
    role: user.role,
    displayName: user.displayName,
    login: user.login,
  };
}

function permissionsForRole(role) {
  return [...(ROLE_PERMISSIONS[role] || [])];
}

function hasPermission(session, permission) {
  return session?.permissions?.includes(permission);
}

function hasAnyPermission(session, permissions = []) {
  return permissions.some((permission) => hasPermission(session, permission));
}

function requireAuth(policy = {}) {
  const normalized = normalizePolicy(policy);
  return (req, res, next) => {
    const auth = req.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const session = getSession(token);
    if (!session) {
      res.status(401).json({ error: "UNAUTHENTICATED", message: "Please login first" });
      return;
    }

    if (normalized.roles.length && !normalized.roles.includes(session.user.role)) {
      res.status(403).json({ error: "FORBIDDEN", message: "Role is not allowed" });
      return;
    }

    if (normalized.permissions.length && !hasAnyPermission(session, normalized.permissions)) {
      res.status(403).json({ error: "FORBIDDEN", message: "Permission denied" });
      return;
    }

    req.user = session.user;
    req.auth = {
      claims: session.claims,
      permissions: session.permissions,
    };
    req.token = token;
    next();
  };
}

function requirePermission(...permissions) {
  return requireAuth({ permissions: permissions.flat() });
}

function normalizePolicy(policy) {
  if (Array.isArray(policy)) {
    return { roles: policy, permissions: [] };
  }
  if (typeof policy === "string") {
    return { roles: [policy], permissions: [] };
  }
  return {
    roles: Array.isArray(policy.roles) ? policy.roles : [],
    permissions: Array.isArray(policy.permissions) ? policy.permissions : [],
  };
}

function signJwt(payload) {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = createSignature(`${encodedHeader}.${encodedPayload}`);
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function verifyJwt(token, options = {}) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, signature] = parts;
  const expected = createSignature(`${encodedHeader}.${encodedPayload}`);
  if (!safeEqual(signature, expected)) return null;

  let header;
  let payload;
  try {
    header = JSON.parse(base64UrlDecode(encodedHeader));
    payload = JSON.parse(base64UrlDecode(encodedPayload));
  } catch (_) {
    return null;
  }

  if (header.alg !== "HS256" || header.typ !== "JWT") return null;
  if (payload.iss !== JWT_ISSUER) return null;
  if (!payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) return null;
  if (!options.ignoreRevocation && revokedTokenIds.has(payload.jti)) return null;
  return payload;
}

function createSignature(input) {
  return crypto.createHmac("sha256", JWT_SECRET).update(input).digest("base64url");
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function purgeRevokedTokens() {
  const now = Math.floor(Date.now() / 1000);
  for (const [jti, expiresAt] of revokedTokenIds.entries()) {
    if (expiresAt <= now) {
      revokedTokenIds.delete(jti);
    }
  }
}

module.exports = {
  ROLE_PERMISSIONS,
  getSession,
  hasPermission,
  issueSession,
  permissionsForRole,
  requireAuth,
  requirePermission,
  revokeSession,
  verifyLogin,
};
