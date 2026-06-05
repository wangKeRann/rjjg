export function getSession() {
  const raw = localStorage.getItem("cinema-session");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    localStorage.removeItem("cinema-session");
    return null;
  }
}

export function saveSession(session) {
  localStorage.setItem("cinema-session", JSON.stringify(session));
}

export function clearSession() {
  localStorage.removeItem("cinema-session");
}

export function authHeaders() {
  const session = getSession();
  return session?.token ? { Authorization: `Bearer ${session.token}` } : {};
}

export async function apiFetch(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || response.statusText);
  return body;
}

export async function logout() {
  const session = getSession();
  if (session?.token) {
    await apiFetch("/api/auth/logout", {
      method: "POST",
      headers: authHeaders(),
    }).catch(() => {});
  }
  clearSession();
  location.href = "/login.html";
}

export function requireRole(role) {
  const session = getSession();
  if (!session) {
    location.href = "/login.html";
    return null;
  }
  if (role && session.user.role !== role) {
    location.href = session.user.role === "ADMIN" ? "/admin-sales.html" : "/movies.html";
    return null;
  }
  return session;
}

export function pageShellData() {
  return {
    session: getSession(),
    logout,
  };
}

export function posterStyle(movie) {
  return {
    background: `
      radial-gradient(circle at 30% 18%, ${movie.accent || "#ffffff"} 0, transparent 28%),
      linear-gradient(145deg, ${movie.posterTone}, #141820 72%)
    `,
  };
}

export function lowestPrice(movie) {
  return Math.min(...movie.shows.map((show) => show.price));
}
