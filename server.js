require("dotenv").config();
const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");

const app = express();

const PORT = process.env.PORT || process.env.GATEWAY_PORT || 5000;

// ─── Backend service URLs (set these as env vars on Render) ──────────────────
const USER_SERVICE_URL       = process.env.USER_SERVICE_URL       || "http://localhost:5001";
const SELLER_SERVICE_URL     = process.env.SELLER_SERVICE_URL     || "http://localhost:5002";
const ADMIN_SERVICE_URL      = process.env.ADMIN_SERVICE_URL      || "http://localhost:5003";
const SUPERADMIN_SERVICE_URL = process.env.SUPERADMIN_SERVICE_URL || "http://localhost:5004";

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());

// ─── Gateway Health Check ─────────────────────────────────────────────────────
app.get(["/health", "/api/v1/health"], (req, res) => {
  res.status(200).json({
    status:    "ok",
    gateway:   "GreenCard API Gateway v2.0",
    timestamp: new Date().toISOString(),
    routing: {
      "user-backend":       USER_SERVICE_URL,
      "seller-backend":     SELLER_SERVICE_URL,
      "admin-backend":      ADMIN_SERVICE_URL,
      "superadmin-backend": SUPERADMIN_SERVICE_URL,
    },
  });
});

// ─── Proxy factory (shared options) ──────────────────────────────────────────
const proxy = (target, label) =>
  createProxyMiddleware({
    target,
    changeOrigin: true,
    // Transparent cookie forwarding so JWT auth works end-to-end
    on: {
      error: (err, req, res) => {
        console.error(`[Gateway → ${label}] ${err.message} for ${req.method} ${req.url}`);
        res.status(502).json({
          status:  502,
          message: "Backend service is temporarily unavailable. Please try again shortly.",
          service: label,
        });
      },
    },
  });

// ═════════════════════════════════════════════════════════════════════════════
//  ROUTE TABLE — which portal calls which backend
//
//  User Portal    → USER backend + SELLER backend
//  Seller Portal  → SELLER backend + USER backend (auth only)
//  Admin Portal   → ADMIN backend + USER backend + SELLER backend
//  SuperAdmin     → SUPERADMIN backend + ADMIN backend + USER backend
// ═════════════════════════════════════════════════════════════════════════════

// ─── USER BACKEND ─────────────────────────────────────────────────────────────
// Callers: User Portal (main), Seller Portal (auth), Admin Portal (orders/reviews)
// SuperAdmin Portal (platform stats)
app.use(
  [
    "/api/v1/users",           // register, login, profile — ALL portals use auth
    "/api/v1/addresses",       // saved delivery addresses — User Portal
    "/api/v1/cart",            // cart + /cart/validate-stock — User Portal
    "/api/v1/orders",          // place order, order history — User Portal + Admin Portal
    "/api/v1/returns",         // return requests — User Portal
    "/api/v1/wishlist",        // wishlist — User Portal
    "/api/v1/reviews",         // reviews — User Portal + Admin Portal (moderation)
    "/api/v1/contact",         // contact form — User Portal
    "/api/v1/access-requests", // become-seller form — User Portal; approval — Admin Portal
  ],
  proxy(USER_SERVICE_URL, "user-backend")
);

// ─── SELLER BACKEND ───────────────────────────────────────────────────────────
// Callers: User Portal (read product/category/stock), Seller Portal (CRUD),
//          Admin Portal (products + site-content + categories management)
app.use(
  [
    "/api/v1/products",     // product listings, search, detail — User Portal reads; Seller/Admin write
    "/api/v1/categories",   // category tree — User Portal nav; Seller product form; Admin manage
    "/api/v1/site-content", // banners, flash-sale settings — User Portal reads; Admin writes
    "/api/v1/stock",        // SSE stock stream — User Portal subscribes (/api/v1/stock/stream)
    "/api/v1/seller",       // seller dashboard, seller orders, seller reviews — Seller Portal
    "/api/v1/sellers",      // seller public profile — Seller Portal
  ],
  proxy(SELLER_SERVICE_URL, "seller-backend")
);

// ─── ADMIN BACKEND ────────────────────────────────────────────────────────────
// Callers: Admin Portal (main), SuperAdmin Portal (staff list)
app.use(
  [
    "/api/v1/staff",  // staff accounts, login, permissions — Admin Portal + SuperAdmin Portal
    "/api/v1/admin",  // admin dashboard stats, seller applications approval — Admin Portal
  ],
  proxy(ADMIN_SERVICE_URL, "admin-backend")
);

// ─── SUPERADMIN BACKEND ───────────────────────────────────────────────────────
// Caller: SuperAdmin Portal ONLY — highest privilege, append-only audit logs
app.use(
  [
    "/api/v1/superadmin", // superadmin dashboard, audit logs, role promotion
  ],
  proxy(SUPERADMIN_SERVICE_URL, "superadmin-backend")
);

// ─── 404 for unknown routes ───────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    status:  404,
    message: `Route ${req.method} ${req.originalUrl} does not exist in this API Gateway`,
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const startKeepAlive = require("./keepAlive");
  app.listen(PORT, () => {
    console.log(`🌐 GreenCard API Gateway running on port ${PORT}`);
    console.log(`   🟢 User Backend      → ${USER_SERVICE_URL}`);
    console.log(`   🟠 Seller Backend    → ${SELLER_SERVICE_URL}`);
    console.log(`   🔵 Admin Backend     → ${ADMIN_SERVICE_URL}`);
    console.log(`   🔴 SuperAdmin Backend→ ${SUPERADMIN_SERVICE_URL}`);
    console.log(`\n   Route Ownership:`);
    console.log(`   /api/v1/users, cart, orders, wishlist, reviews, contact, returns, addresses, access-requests → USER`);
    console.log(`   /api/v1/products, categories, site-content, stock, seller, sellers → SELLER`);
    console.log(`   /api/v1/staff, admin → ADMIN`);
    console.log(`   /api/v1/superadmin → SUPERADMIN`);

    // Start mesh keep-alive pinging on Render
    startKeepAlive({
      user: USER_SERVICE_URL,
      seller: SELLER_SERVICE_URL,
      admin: ADMIN_SERVICE_URL,
      superadmin: SUPERADMIN_SERVICE_URL,
    });
  });
}

module.exports = app;
