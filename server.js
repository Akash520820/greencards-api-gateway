require("dotenv").config();
const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");
const cors = require("cors");
const cookieParser = require("cookie-parser");

const app = express();

const PORT = process.env.GATEWAY_PORT || 5000;
const USER_SERVICE_URL = process.env.USER_SERVICE_URL || "http://localhost:5001";
const SELLER_SERVICE_URL = process.env.SELLER_SERVICE_URL || "http://localhost:5002";
const ADMIN_SERVICE_URL = process.env.ADMIN_SERVICE_URL || "http://localhost:5003";
const SUPERADMIN_SERVICE_URL = process.env.SUPERADMIN_SERVICE_URL || "http://localhost:5004";

app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());

// Gateway Health Check
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    gateway: "GreenCard API Gateway v1.0",
    timestamp: new Date().toISOString(),
    services: {
      user: USER_SERVICE_URL,
      seller: SELLER_SERVICE_URL,
      admin: ADMIN_SERVICE_URL,
      superadmin: SUPERADMIN_SERVICE_URL,
    },
  });
});

// User Service
app.use(
  ["/api/v1/users", "/api/v1/addresses", "/api/v1/cart", "/api/v1/wishlist", "/api/v1/products", "/api/v1/reviews", "/api/v1/orders", "/api/v1/returns", "/api/v1/contact"],
  createProxyMiddleware({ target: USER_SERVICE_URL, changeOrigin: true })
);

// Seller Service
app.use(
  ["/api/v1/seller", "/api/v1/sellers"],
  createProxyMiddleware({ target: SELLER_SERVICE_URL, changeOrigin: true })
);

// Admin Service
app.use(
  ["/api/v1/admin", "/api/v1/categories", "/api/v1/coupons", "/api/v1/site-content"],
  createProxyMiddleware({ target: ADMIN_SERVICE_URL, changeOrigin: true })
);

// SuperAdmin Service
app.use(
  ["/api/v1/superadmin", "/api/v1/staff"],
  createProxyMiddleware({ target: SUPERADMIN_SERVICE_URL, changeOrigin: true })
);

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🌐 GreenCard API Gateway listening on port ${PORT}`);
  });
}

module.exports = app;
