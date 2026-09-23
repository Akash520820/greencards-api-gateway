// Self-ping & downstream microservices keep-alive for Render.com
// Pings the gateway and all 4 microservices every 10 minutes so Render's
// 15-minute free-tier inactivity sleep window never triggers.

const PING_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const PING_TIMEOUT_MS = 10 * 1000;

const startKeepAlive = (services = {}) => {
  const baseUrl = process.env.RENDER_EXTERNAL_URL;

  const targets = [];
  if (baseUrl) {
    targets.push({ name: "api-gateway", url: `${baseUrl.replace(/\/$/, "")}/health` });
  }

  Object.entries(services).forEach(([name, url]) => {
    if (url && url.startsWith("http")) {
      targets.push({ name, url: `${url.replace(/\/$/, "")}/health` });
    }
  });

  if (targets.length === 0) {
    console.log("[Keep-alive] No external URLs configured, skipping (expected in local dev)");
    return;
  }

  const pingAll = async () => {
    for (const target of targets) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
      try {
        const res = await fetch(target.url, { signal: controller.signal });
        console.log(`[Keep-alive] ${target.name} -> HTTP ${res.status}`);
      } catch (err) {
        console.log(`[Keep-alive] ${target.name} ping failed: ${err.message}`);
      } finally {
        clearTimeout(timeout);
      }
    }
  };

  // Wait 1 minute after boot before first ping, then repeat every 10 minutes
  setTimeout(pingAll, 60 * 1000);
  setInterval(pingAll, PING_INTERVAL_MS);
  console.log(`[Keep-alive] Mesh pinger initialized for ${targets.length} targets (every 10m)`);
};

module.exports = startKeepAlive;
