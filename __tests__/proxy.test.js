/**
 * Behaviour tests for the API gateway proxy. They start four fake upstream
 * services and check what the gateway forwards. Runs with Node's built-in
 * test runner: `node --test __tests__/`  (no extra dependency).
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const seen = {}; // label -> last request seen by that upstream
const startUpstream = (label) =>
  new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        seen[label] = { method: req.method, url: req.url, headers: req.headers, body };
        if (req.url.startsWith("/api/v1/stock/stream")) {
          res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
          res.write("data: first\n\n");
          setTimeout(() => { res.write("data: second\n\n"); res.end(); }, 400);
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json", "Set-Cookie": "up=1; Path=/; HttpOnly" });
        res.end(JSON.stringify({ upstream: label, url: req.url }));
      });
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });

const request = (port, { method = "GET", path, headers = {}, body } = {}) =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });

let servers = [], gateway, gwPort;

test.before(async () => {
  const labels = ["user", "seller", "admin", "superadmin"];
  servers = await Promise.all(labels.map(startUpstream));
  labels.forEach((l, i) => (process.env[`${l.toUpperCase()}_SERVICE_URL`] = `http://127.0.0.1:${servers[i].address().port}`));
  process.env.FRONTEND_ORIGINS = "https://akash520820.github.io";
  const app = require("../server");
  gateway = http.createServer(app);
  await new Promise((r) => gateway.listen(0, "127.0.0.1", r));
  gwPort = gateway.address().port;
});

test.after(() => { gateway.close(); servers.forEach((s) => s.close()); });

const routes = [
  ["/api/v1/users/login", "user"], ["/api/v1/addresses", "user"], ["/api/v1/products?x=1", "user"],
  ["/api/v1/cart", "user"], ["/api/v1/orders", "user"], ["/api/v1/returns", "user"],
  ["/api/v1/wishlist", "user"], ["/api/v1/reviews", "user"], ["/api/v1/contact", "user"],
  ["/api/v1/seller/dashboard", "seller"], ["/api/v1/sellers/1", "seller"], ["/api/v1/stock/x", "seller"],
  ["/api/v1/admin/stats", "admin"], ["/api/v1/categories", "admin"], ["/api/v1/coupons", "admin"],
  ["/api/v1/site-content", "admin"], ["/api/v1/site_content", "admin"],
  ["/api/v1/staff/login", "superadmin"], ["/api/v1/superadmin/dashboard", "superadmin"],
];
for (const [path, label] of routes) {
  test(`routes ${path} -> ${label}-backend`, async () => {
    const r = await request(gwPort, { path });
    assert.equal(r.status, 200);
    assert.equal(JSON.parse(r.body).upstream, label);
    assert.equal(seen[label].url, path); // path and query string preserved unchanged
  });
}

test("forwards cookies and request body, keeps the method", async () => {
  const r = await request(gwPort, { method: "POST", path: "/api/v1/staff/login", headers: { "Content-Type": "application/json", Cookie: "staffAccessToken=abc" }, body: '{"a":1}' });
  assert.equal(r.status, 200);
  assert.equal(seen.superadmin.method, "POST");
  assert.equal(seen.superadmin.headers.cookie, "staffAccessToken=abc");
  assert.equal(seen.superadmin.body, '{"a":1}');
});

test("does NOT forward the Origin header to the backend", async () => {
  await request(gwPort, { path: "/api/v1/users/me", headers: { Origin: "https://akash520820.github.io" } });
  assert.equal(seen.user.headers.origin, undefined);
});

test("passes Set-Cookie from the backend back to the browser", async () => {
  const r = await request(gwPort, { path: "/api/v1/users/me" });
  assert.match(String(r.headers["set-cookie"]), /up=1/);
});

test("unknown route gets the gateway's own 404 JSON", async () => {
  const r = await request(gwPort, { path: "/api/v1/nothing-here" });
  assert.equal(r.status, 404);
  assert.match(JSON.parse(r.body).message, /does not exist in this API Gateway/);
});

test("gateway /health answers itself", async () => {
  const r = await request(gwPort, { path: "/health" });
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(r.body).status, "ok");
});

test("server-sent events stream through without waiting for the end", async () => {
  const t0 = Date.now();
  const first = await new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: gwPort, path: "/api/v1/stock/stream" }, (res) => {
      res.once("data", (c) => { resolve({ at: Date.now() - t0, text: String(c) }); req.destroy(); });
    });
    req.on("error", () => {}); req.end();
    setTimeout(() => reject(new Error("no data")), 3000);
  });
  assert.match(first.text, /first/);
  assert.ok(first.at < 350, `first chunk took ${first.at}ms (should arrive before the 400ms second chunk)`);
});

test("returns 502 JSON with the service name when a backend is down", async () => {
  servers[1].close(); // seller goes away
  await new Promise((r) => setTimeout(r, 50));
  const r = await request(gwPort, { path: "/api/v1/seller/dashboard" });
  assert.equal(r.status, 502);
  const b = JSON.parse(r.body);
  assert.equal(b.service, "seller-backend");
  assert.equal(b.status, 502);
});
