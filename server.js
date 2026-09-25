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
    gateway:   "GreenCard API Gateway v2.1",
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
const proxy = (target, label, pathFilter) =>
  createProxyMiddleware({
    target,
    changeOrigin: true,
    pathFilter,
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
app.use(
  proxy(USER_SERVICE_URL, "user-backend", [
    "/api/v1/users",           // register, login, profile — ALL portals use auth
    "/api/v1/addresses",       // saved delivery addresses — User Portal
    "/api/v1/products",        // product listings, search, detail (product.routes.js in user-backend)
    "/api/v1/cart",            // cart + /cart/validate-stock — User Portal
    "/api/v1/orders",          // place order, order history — User Portal + Admin Portal
    "/api/v1/returns",         // return requests — User Portal
    "/api/v1/wishlist",        // wishlist — User Portal
    "/api/v1/reviews",         // reviews — User Portal + Admin Portal (moderation)
    "/api/v1/contact",         // contact form — User Portal
    "/api/v1/access-requests", // become-seller form — User Portal; approval — Admin Portal
  ])
);

// ─── SELLER BACKEND ───────────────────────────────────────────────────────────
// Callers: Seller Portal (CRUD & dashboard), User Portal (real-time stock SSE)
app.use(
  proxy(SELLER_SERVICE_URL, "seller-backend", [
    "/api/v1/stock",   // SSE stock stream (/api/v1/stock/stream)
    "/api/v1/seller",  // seller dashboard, seller orders, seller reviews
    "/api/v1/sellers", // seller public profiles
  ])
);

// ─── ADMIN BACKEND ────────────────────────────────────────────────────────────
// Callers: Admin Portal (dashboard, categories, coupons, site content)
app.use(
  proxy(ADMIN_SERVICE_URL, "admin-backend", [
    "/api/v1/admin",        // admin dashboard stats, seller applications
    "/api/v1/categories",   // category tree (category.routes.js in admin-backend)
    "/api/v1/coupons",      // coupons (coupon.routes.js in admin-backend)
    "/api/v1/site-content", // banners, policies (siteContent.routes.js in admin-backend)
  ])
);

// ─── SUPERADMIN BACKEND ───────────────────────────────────────────────────────
// Caller: SuperAdmin Portal (audit logs, role elevation, staff management)
app.use(
  proxy(SUPERADMIN_SERVICE_URL, "superadmin-backend", [
    "/api/v1/superadmin", // superadmin dashboard, audit logs, role promotion
    "/api/v1/staff",      // staff accounts, MFA, login (staff.routes.js in superadmin-backend)
  ])
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
