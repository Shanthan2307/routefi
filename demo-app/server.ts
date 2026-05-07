import express from "express";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const GATEWAY_URL = process.env.GATEWAY_URL || "http://localhost:4402";
const PORT = parseInt(process.env.PORT || "3001");

// Load .env from repo root
try {
  const lines = fs.readFileSync(path.join(REPO_ROOT, ".env"), "utf-8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1).trim();
    if (!(k in process.env)) process.env[k] = v;
  }
} catch {}

const ADMIN_KEY = process.env.RT_ADMIN_KEY || "";

const app = express();
app.use(express.json());

// ── Gateway admin proxy ────────────────────────────────────────────────────
app.all("/api/admin/*", async (req, res) => {
  const p = req.path.replace("/api/admin", "/admin");
  try {
    const r = await fetch(`${GATEWAY_URL}${p}`, {
      method: req.method,
      headers: { "content-type": "application/json", authorization: `Bearer ${ADMIN_KEY}` },
      body: ["POST", "PUT", "PATCH"].includes(req.method) ? JSON.stringify(req.body) : undefined,
    });
    const body = await r.text();
    res.status(r.status).send(body);
  } catch {
    res.status(502).json({ error: "Gateway unreachable" });
  }
});

// ── Raw API proxy (no admin key — simulates agent call) ───────────────────
app.all("/api/raw/*", async (req, res) => {
  const p = req.path.replace("/api/raw", "");
  try {
    const r = await fetch(`${GATEWAY_URL}${p}`, { method: req.method });
    const body = await r.text();
    for (const [k, v] of r.headers.entries()) {
      if (!["transfer-encoding", "connection", "content-encoding"].includes(k))
        res.setHeader(k, v);
    }
    res.status(r.status).send(body);
  } catch {
    res.status(502).json({ error: "Gateway unreachable" });
  }
});

// ── Config ────────────────────────────────────────────────────────────────
app.get("/api/config", (_req, res) => {
  res.json({ gatewayUrl: GATEWAY_URL });
});

// ── Wallet balance — queries Base Sepolia USDC + ETH via RPC ──────────────
const BASE_SEPOLIA_RPC = "https://sepolia.base.org";
const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

app.get("/api/wallet-balance", async (req, res) => {
  const address = req.query.address as string;
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return res.status(400).json({ error: "Invalid address" });
  }

  const rpcCall = (method: string, params: unknown[]) =>
    fetch(BASE_SEPOLIA_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }).then(r => r.json()).then(d => d.result as string);

  try {
    const paddedAddr = address.slice(2).padStart(64, "0");
    const [ethHex, usdcHex] = await Promise.all([
      rpcCall("eth_getBalance", [address, "latest"]),
      rpcCall("eth_call", [{ to: USDC_BASE_SEPOLIA, data: `0x70a08231${paddedAddr}` }, "latest"]),
    ]);

    const eth = (parseInt(ethHex, 16) / 1e18).toFixed(6);
    const usdc = (parseInt(usdcHex, 16) / 1e6).toFixed(4);

    res.json({ address, eth, usdc, usdcContract: USDC_BASE_SEPOLIA, network: "base-sepolia" });
  } catch (err: any) {
    res.status(502).json({ error: "RPC unreachable", detail: err.message });
  }
});

// ── Run agent — SSE stream ────────────────────────────────────────────────
app.get("/api/run-agent", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (type: string, data: object) =>
    res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);

  // ensure @routefi/sdk is resolvable in the worktree
  const nodeModules = path.join(REPO_ROOT, "node_modules");
  const env = { ...process.env, RT_GATEWAY_URL: GATEWAY_URL, NODE_PATH: nodeModules };

  send("log", { tag: "INIT", msg: "Starting Routefi agent..." });

  const proc = spawn("npx", ["tsx", "examples/agent-demo/run.ts"], {
    cwd: REPO_ROOT,
    env,
    shell: false,
  });

  proc.stdout.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n").filter(Boolean)) {
      const m = line.match(/^\[[\d:]+\] \[([A-Z0-9 ]+)\] (.+)$/);
      if (m) send("log", { tag: m[1].trim(), msg: m[2] });
      else if (line.startsWith("===")) send("log", { tag: "---", msg: line.replace(/=/g, "").trim() });
      else send("log", { tag: "OUT", msg: line });
    }
  });

  proc.stderr.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n").filter(Boolean)) {
      if (line.includes("ExperimentalWarning") || line.includes("--experimental")) continue;
      send("log", { tag: "ERR", msg: line });
    }
  });

  proc.on("close", (code: number | null) => {
    send("done", { code, success: code === 0 });
    res.end();
  });

  proc.on("error", (err: Error) => {
    send("log", { tag: "ERR", msg: `Failed to start: ${err.message}` });
    send("done", { code: 1, success: false });
    res.end();
  });

  req.on("close", () => proc.kill());
});

// ── Vite (dev) or static (prod) — must come AFTER all API routes ──────────
if (process.env.NODE_ENV !== "production") {
  const { createServer: createVite } = await import("vite");
  const vite = await createVite({
    root: __dirname,
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
} else {
  app.use(express.static(path.join(__dirname, "dist")));
  app.get("*", (_req, res) =>
    res.sendFile(path.join(__dirname, "dist", "index.html"))
  );
}

app.listen(PORT, () => {
  console.log(`\n  Routefi Demo  →  http://localhost:${PORT}`);
  console.log(`  Gateway       →  ${GATEWAY_URL}\n`);
});
