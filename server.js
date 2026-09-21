require("dotenv").config();
const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");

const app = express();

const PORT = process.env.GATEWAY_PORT || 5000;

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
app.get("/health", (req, res) => {
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

// ─── Proxy helper (shared options) ────────────────────────────────────────────
const proxy = (target) =>
  createProxyMiddleware({
    target,
    changeOrigin: true,
    // Forward cookies transparently so JWT auth works end-to-end
    on: {
      error: (err, req, res) => {
        console.error(`[Gateway] Proxy error → ${target}: ${err.message}`);
        res.status(502).json({
          status:  502,
          message: "Backend service is temporarily unavailable. Please try again shortly.",
        });
      },
    },
  });

// ═════════════════════════════════════════════════════════════════════════════
//  ROUTE OWNERSHIP
//  Each route belongs to exactly ONE backend cluster.
//  User portal calls ONE gateway URL — gateway decides which service answers.
// ═════════════════════════════════════════════════════════════════════════════

// ─── USER BACKEND (greencard-user cluster) ────────────────────────────────────
// Everything that belongs to the logged-in customer:
// auth, cart, orders, wishlist, addresses, returns, contact
app.use(
  [
    "/api/v1/users",      // register, login, profile, password reset
    "/api/v1/addresses",  // saved delivery addresses
    "/api/v1/cart",       // cart + /cart/validate-stock (pre-flight check)
    "/api/v1/orders",     // place order, order history, invoice, razorpay webhook
    "/api/v1/returns",    // return requests
    "/api/v1/wishlist",   // wishlist add/remove
    "/api/v1/contact",    // contact-us form
    "/api/v1/reviews",    // user submits/reads reviews (user-backend owns review writes)
  ],
  proxy(USER_SERVICE_URL)
);

// ─── SELLER BACKEND (greencard-seller cluster) ────────────────────────────────
// Everything the USER PORTAL reads from the seller side:
// • product listings, search, product detail pages   → user portal reads these
// • categories for navigation / filter sidebar       → user portal reads these
// • coupons for checkout coupon validation           → user portal reads these
// • site content (banners, announcements)            → user portal reads these
// • seller dashboard, inventory management           → seller portal writes these
// • SSE stock stream for real-time stock updates     → user portal subscribes
app.use(
  [
    "/api/v1/products",     // product listings, search, detail — USER PORTAL READS THIS
    "/api/v1/categories",   // category tree for navigation — USER PORTAL READS THIS
    "/api/v1/coupons",      // coupon validation at checkout — USER PORTAL READS THIS
    "/api/v1/site-content", // banners, flash sale content — USER PORTAL READS THIS
    "/api/v1/stock",        // SSE stock stream — USER PORTAL SUBSCRIBES HERE
    "/api/v1/seller",       // seller dashboard routes (seller portal)
    "/api/v1/sellers",      // seller profile public data
  ],
  proxy(SELLER_SERVICE_URL)
);

// ─── ADMIN BACKEND (greencard-admin cluster) ──────────────────────────────────
// Staff-only routes — admin portal only, never called by user/seller portals
app.use(
  [
    "/api/v1/admin",           // admin dashboard operations
    "/api/v1/access-requests", // seller access request management
  ],
  proxy(ADMIN_SERVICE_URL)
);

// ─── SUPERADMIN BACKEND (greencard-superadmin cluster) ───────────────────────
// Superadmin-only routes — highest privilege, audit log viewer
app.use(
  [
    "/api/v1/superadmin", // superadmin dashboard
    "/api/v1/staff",      // staff account management
  ],
  proxy(SUPERADMIN_SERVICE_URL)
);

// ─── 404 for unknown routes ───────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    status:  404,
    message: `Route ${req.method} ${req.originalUrl} not found in API Gateway`,
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🌐 GreenCard API Gateway running on port ${PORT}`);
    console.log(`   User Backend    → ${USER_SERVICE_URL}`);
    console.log(`   Seller Backend  → ${SELLER_SERVICE_URL}`);
    console.log(`   Admin Backend   → ${ADMIN_SERVICE_URL}`);
    console.log(`   SuperAdmin      → ${SUPERADMIN_SERVICE_URL}`);
  });
}

module.exports = app;
