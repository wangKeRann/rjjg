const assert = require("node:assert/strict");
const test = require("node:test");
const { app, store, orders } = require("../src/server");

function listen() {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function request(server, path, options = {}) {
  const port = server.address().port;
  const response = await fetch(`http://127.0.0.1:${port}${path}`, options);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function login(server, portal, loginName, password) {
  const result = await request(server, "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ portal, login: loginName, password }),
  });
  assert.equal(result.response.status, 200);
  return result.body.token;
}

test("customer must login before ordering, then can pay locked seats", async () => {
  await store.connect();
  orders.clear();
  const server = await listen();

  try {
    const rejected = await request(server, "/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ showId: "s1", seats: ["B1"] }),
    });
    assert.equal(rejected.response.status, 401);

    const token = await login(server, "customer", "13800000000", "123456");
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

    const created = await request(server, "/api/orders", {
      method: "POST",
      headers,
      body: JSON.stringify({ showId: "s1", seats: ["B1", "B2"] }),
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.order.status, "PENDING_PAYMENT");

    const locked = await request(server, "/api/orders", {
      method: "POST",
      headers,
      body: JSON.stringify({ showId: "s1", seats: ["B1"] }),
    });
    assert.equal(locked.response.status, 409);
    assert.equal(locked.body.error, "SEAT_TEMPORARILY_LOCKED");

    const paid = await request(server, `/api/orders/${created.body.order.id}/pay`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(paid.response.status, 200);
    assert.equal(paid.body.order.status, "PAID");

    const seats = await request(server, "/api/shows/s1/seats");
    const b1 = seats.body.seats.find((seat) => seat.id === "B1");
    assert.equal(b1.status, "sold");
  } finally {
    server.close();
    await store.close();
  }
});

test("customer cannot create one order with more than four seats", async () => {
  await store.connect();
  orders.clear();
  const server = await listen();

  try {
    const token = await login(server, "customer", "13800000000", "123456");
    const created = await request(server, "/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ showId: "s1", seats: ["A3", "A4", "A5", "A6", "A7"] }),
    });

    assert.equal(created.response.status, 400);
    assert.equal(created.body.error, "INVALID_SEAT_COUNT");
    assert.equal(created.body.maxSeats, 4);
  } finally {
    server.close();
    await store.close();
  }
});

test("admin can view dashboard and update show price", async () => {
  await store.connect();
  const server = await listen();

  try {
    const customerToken = await login(server, "customer", "13800000000", "123456");
    const denied = await request(server, "/api/admin/dashboard", {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    assert.equal(denied.response.status, 403);

    const adminToken = await login(server, "admin", "admin", "admin123");
    const dashboard = await request(server, "/api/admin/dashboard", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(dashboard.response.status, 200);
    assert.ok(dashboard.body.shows.length >= 1);

    const show = dashboard.body.shows.find((item) => item.id === "s2");
    const updated = await request(server, `/api/admin/shows/${show.id}/price`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ price: show.price + 3 }),
    });
    assert.equal(updated.response.status, 200);
    assert.equal(updated.body.show.price, show.price + 3);
  } finally {
    server.close();
    await store.close();
  }
});

test("movie search remains available for the customer side", async () => {
  await store.connect();
  const server = await listen();

  try {
    const search = await request(server, "/api/search?q=IMAX");
    assert.equal(search.response.status, 200);
    assert.ok(search.body.movies.length >= 1);
  } finally {
    server.close();
    await store.close();
  }
});

test("movies list cache returns the full catalog on repeated requests", async () => {
  await store.connect();
  await store.invalidateBrowseCache();
  const server = await listen();

  try {
    const first = await request(server, "/api/movies");
    assert.equal(first.response.status, 200);
    const total = first.body.movies.length;
    assert.ok(total >= 1);

    const second = await request(server, "/api/movies");
    assert.equal(second.response.status, 200);
    assert.equal(second.body.movies.length, total);
    assert.equal(second.body.cached, true);
  } finally {
    server.close();
    await store.close();
  }
});
