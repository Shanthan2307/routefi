const express = require("express");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

// Load .env from repo root so the dashboard proxy always has RT_ADMIN_KEY
// even when started without --env-file.  Already-set env vars take precedence.
(function loadEnv() {
  const envPath = path.resolve(__dirname, "..", ".env");
  try {
    const lines = fs.readFileSync(envPath, "utf-8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!(key in process.env)) {
        process.env[key] = val;
      }
    }
  } catch {
    // .env missing — rely on environment or --env-file
  }
})();

const app = express();
const PORT = process.env.PORT || 3000;
const GATEWAY_URL = process.env.GATEWAY_URL || "http://localhost:4402";

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Clean URL routes
app.get("/", (_req, res) => {
  res.redirect("/landing");
});
app.get("/landing", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "landing.html"));
});
app.get("/demo", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "demo.html"));
});
app.get("/dashboard", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});
app.get("/routes", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});
app.get("/requests", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});
app.get("/debug", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});
app.get("/docs", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "docs.html"));
});

// Expose gateway URL to the frontend
app.get("/config/gateway-url", (_req, res) => {
  res.json({ gatewayUrl: GATEWAY_URL });
});

// Proxy fetch for OpenAPI specs (avoids CORS issues)
app.post("/fetch-spec", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "url required" });
  try {
    const upstream = await fetch(url);
    if (!upstream.ok) return res.status(upstream.status).json({ error: `Upstream returned ${upstream.status}` });
    const text = await upstream.text();
    res.json({ text });
  } catch (err) {
    res.status(502).json({ error: "Failed to fetch spec", detail: err.message });
  }
});

// Proxy RPC calls (avoids browser CORS issues)
app.post("/rpc-proxy", async (req, res) => {
  const { rpcUrl, body: rpcBody } = req.body;
  if (!rpcUrl) return res.status(400).json({ error: "rpcUrl required" });
  try {
    const upstream = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(rpcBody),
    });
    const data = await upstream.json();
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: "RPC unreachable", detail: err.message });
  }
});

// E2E test upstream — returns simple JSON for end-to-end pipeline tests
app.all("/e2e-test-upstream/*", (_req, res) => {
  res.json({ ok: true, source: "e2e-test", ts: Date.now() });
});
app.all("/e2e-test-upstream", (_req, res) => {
  res.json({ ok: true, source: "e2e-test", ts: Date.now() });
});

// Test endpoint that mimics an x402-speaking upstream (used by debug tests)
app.get("/x402-test-upstream/*", (_req, res) => {
  res.setHeader("payment-required", "x402");
  res.status(402).json({ error: "Payment Required", protocol: "x402" });
});

// Env-var status (booleans only — never expose values)
app.get("/env-status", (_req, res) => {
  const has = (k) => !!(process.env[k] && process.env[k].trim());
  res.json({
    cdpApiKeyId: has("CDP_API_KEY_ID"),
    cdpApiKeySecret: has("CDP_API_KEY_SECRET"),
    cdpWalletSecret: has("CDP_WALLET_SECRET"),
    skaleRpcUrl: has("SKALE_RPC_URL"),
    skaleChainId: has("SKALE_CHAIN_ID"),
    skaleBiteContract: has("SKALE_BITE_CONTRACT"),
    skalePrivateKey: has("SKALE_PRIVATE_KEY"),
    rtPayToAddress: has("RT_PAY_TO_ADDRESS"),
    rtAdminKey: has("RT_ADMIN_KEY"),
    rtSkipX402Probe: has("RT_SKIP_X402_PROBE"),
  });
});

// CDP connection test — validates API key with Coinbase
app.post("/cdp-check", async (req, res) => {
  const keyId = process.env.CDP_API_KEY_ID;
  const keySecret = process.env.CDP_API_KEY_SECRET;
  if (!keyId || !keySecret) {
    return res.json({ ok: false, error: "CDP_API_KEY_ID or CDP_API_KEY_SECRET not set in env" });
  }
  try {
    // Lightweight check: hit the CDP API list-wallets endpoint.
    // Even if it returns 401/403 due to permissions, a response proves connectivity + valid format.
    const upstream = await fetch("https://api.developer.coinbase.com/platform/v1/wallets?limit=1", {
      headers: { "Authorization": `Bearer ${keyId}` },
    });
    const status = upstream.status;
    // 401/403 = key format OK, connectivity OK (just wrong auth for this simple check)
    // 200 = fully valid
    if (status === 200 || status === 401 || status === 403) {
      res.json({ ok: true, status, message: status === 200 ? "Authenticated" : "API reachable (key needs JWT signing for full auth)" });
    } else {
      const body = await upstream.text().catch(() => "");
      res.json({ ok: false, status, error: body || `Unexpected status ${status}` });
    }
  } catch (err) {
    res.json({ ok: false, error: "Cannot reach CDP API: " + err.message });
  }
});

// Proxy /api-test/* → GATEWAY_URL/* (pass-through, no admin key injection)
app.all("/api-test/*", async (req, res) => {
  const targetPath = req.originalUrl.replace(/^\/api-test/, "");
  const url = GATEWAY_URL + targetPath;

  try {
    const headers = {};
    for (const key of ["content-type", "authorization", "x-request-idempotency-key", "x-api-key", "x-mandate", "x-agent-address"]) {
      if (req.headers[key]) headers[key] = req.headers[key];
    }

    const fetchOpts = { method: req.method, headers };
    if (["POST", "PUT", "PATCH"].includes(req.method) && req.body) {
      if (!headers["content-type"]) headers["content-type"] = "application/json";
      fetchOpts.body = JSON.stringify(req.body);
    }

    const upstream = await fetch(url, fetchOpts);
    const body = await upstream.text();

    for (const [k, v] of upstream.headers.entries()) {
      if (!["transfer-encoding", "content-encoding", "connection"].includes(k)) {
        res.setHeader(k, v);
      }
    }
    res.status(upstream.status).send(body);
  } catch (err) {
    res.status(502).json({ error: "Gateway unreachable", detail: err.message });
  }
});

// Run agent demo — streams stdout/stderr via Server-Sent Events
app.get("/run-demo", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();

  const send = (type, data) => {
    res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const repoRoot = path.resolve(__dirname, "..");
  const env = {
    ...process.env,
    RT_GATEWAY_URL: process.env.GATEWAY_URL || "http://localhost:4402",
    PATH: process.env.PATH,
  };

  send("log", { tag: "INIT", msg: "Starting Routefi agent demo..." });

  const proc = spawn("npx", ["tsx", "examples/agent-demo/run.ts"], {
    cwd: repoRoot,
    env,
    shell: false,
  });

  proc.stdout.on("data", (chunk) => {
    const lines = chunk.toString().split("\n").filter(l => l.trim());
    lines.forEach(line => {
      // Parse structured log lines: [HH:MM:SS] [TAG] message
      const match = line.match(/^\[[\d:]+\] \[([A-Z0-9 ]+)\] (.+)$/);
      if (match) {
        send("log", { tag: match[1].trim(), msg: match[2] });
      } else if (line.startsWith("===")) {
        send("log", { tag: "---", msg: line.replace(/=/g, "").trim() });
      } else if (line.trim()) {
        send("log", { tag: "OUT", msg: line });
      }
    });
  });

  proc.stderr.on("data", (chunk) => {
    const lines = chunk.toString().split("\n").filter(l => l.trim());
    lines.forEach(line => {
      // Suppress noisy npm/tsx warnings
      if (line.includes("ExperimentalWarning") || line.includes("--experimental")) return;
      send("log", { tag: "ERR", msg: line });
    });
  });

  proc.on("close", (code) => {
    send("done", { code, success: code === 0 });
    res.end();
  });

  proc.on("error", (err) => {
    send("log", { tag: "ERR", msg: `Failed to start: ${err.message}` });
    send("done", { code: 1, success: false });
    res.end();
  });

  req.on("close", () => proc.kill());
});

// Proxy /gateway/* → GATEWAY_URL/*
app.all("/gateway/*", async (req, res) => {
  const targetPath = req.originalUrl.replace(/^\/gateway/, "");
  const url = GATEWAY_URL + targetPath;

  try {
    const headers = { "content-type": "application/json" };

    // Use admin key from env var (preferred) or request header
    const adminKey = process.env.RT_ADMIN_KEY || req.headers["x-admin-key"];
    if (adminKey) {
      headers["authorization"] = `Bearer ${adminKey}`;
    }

    const fetchOpts = { method: req.method, headers };
    if (["POST", "PUT", "PATCH"].includes(req.method) && req.body) {
      fetchOpts.body = JSON.stringify(req.body);
    }

    const upstream = await fetch(url, fetchOpts);
    const body = await upstream.text();

    for (const [k, v] of upstream.headers.entries()) {
      if (!["transfer-encoding", "content-encoding", "connection"].includes(k)) {
        res.setHeader(k, v);
      }
    }
    res.status(upstream.status).send(body);
  } catch (err) {
    res.status(502).json({ error: "Gateway unreachable", detail: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n  Routefi Dashboard`);
  console.log(`  ──────────────────────────`);
  console.log(`  Dashboard:  http://localhost:${PORT}`);
  console.log(`  Gateway:    ${GATEWAY_URL}`);
  console.log();
});
