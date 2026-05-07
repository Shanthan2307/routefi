import { useState, useEffect, useRef, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────
type Page = "landing" | "demo" | "dashboard";
interface Route { tool_id: string; path: string; method: string; price_usdc: string; description?: string; provider: { provider_id: string; backend_url: string } }
interface Receipt { request_id: string; tool_id: string; endpoint: string; method: string; outcome: string; price_usdc: string; payment_tx_hash: string | null; timestamp: string; explanation: string }
interface Health { status: string; uptime_human: string; route_count: number; receipt_count: number }
interface Stats { total_requests: number; success_count: number; denied_count: number; success_rate: string; total_usdc: string; avg_latency_ms: number }
interface LogLine { tag: string; msg: string }

// ─── API helpers ──────────────────────────────────────────────────────────────
const api = {
  health: () => fetch("/api/admin/health").then(r => r.json()) as Promise<Health>,
  routes: () => fetch("/api/admin/routes").then(r => r.json()).then(d => d.routes as Route[]),
  receipts: (limit = 50) => fetch(`/api/admin/receipts?limit=${limit}`).then(r => r.json()).then(d => d.receipts as Receipt[]),
  stats: () => fetch("/api/admin/receipts/stats").then(r => r.json()) as Promise<Stats>,
  addRoute: (body: object) => fetch("/api/admin/routes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  deleteRoute: (id: string) => fetch(`/api/admin/routes/${id}`, { method: "DELETE" }),
  clearReceipts: () => fetch("/api/admin/receipts", { method: "DELETE" }),
  rawHit: (path: string) => fetch(`/api/raw${path}`, { method: "GET" }),
};

// ─── Design tokens ────────────────────────────────────────────────────────────
const C = {
  bg: "#06060f", surface: "#0d0d1a", surface2: "#13131f", border: "#1a1a2e",
  brand: "#3b82f6", brand2: "#7c3aed", green: "#10b981", yellow: "#f59e0b",
  red: "#ef4444", text: "#e2e8f0", muted: "#94a3b8", muted2: "#64748b",
};
const grad = `linear-gradient(135deg, ${C.brand}, ${C.brand2})`;

// ─── Reusable components ──────────────────────────────────────────────────────
const Btn = ({ children, onClick, variant = "primary", disabled = false, small = false, style = {} }: {
  children: React.ReactNode; onClick?: () => void; variant?: "primary" | "ghost" | "danger";
  disabled?: boolean; small?: boolean; style?: React.CSSProperties;
}) => {
  const base: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: 6, border: "none", borderRadius: 8,
    fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1,
    fontSize: small ? 12 : 13, padding: small ? "4px 12px" : "8px 18px",
    transition: "opacity .15s", fontFamily: "inherit",
  };
  const variants = {
    primary: { background: grad, color: "#fff" },
    ghost: { background: "transparent", color: C.muted, border: `1px solid ${C.border}` },
    danger: { background: C.red + "22", color: C.red, border: `1px solid ${C.red}44` },
  };
  return <button onClick={disabled ? undefined : onClick} style={{ ...base, ...variants[variant], ...style }}>{children}</button>;
};

const Card = ({ children, style = {} }: { children: React.ReactNode; style?: React.CSSProperties }) => (
  <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "1.25rem", ...style }}>
    {children}
  </div>
);

const Badge = ({ children, color = C.brand }: { children: React.ReactNode; color?: string }) => (
  <span style={{ background: color + "22", color, border: `1px solid ${color}44`, borderRadius: 6, padding: "2px 10px", fontSize: 11, fontWeight: 700, letterSpacing: "0.04em" }}>
    {children}
  </span>
);

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: C.muted2, marginBottom: "0.75rem" }}>{children}</div>
);

const outcomeColor = (o: string) => o === "SUCCESS" ? C.green : o === "DENIED" ? C.yellow : C.red;
const tagColor = (t: string) => {
  const u = t.toUpperCase();
  if (["INIT", "WALLET"].includes(u)) return "#60a5fa";
  if (["200 OK", "DONE"].includes(u)) return C.green;
  if (u === "RECEIPT") return "#a78bfa";
  if (["ERR", "ERROR"].includes(u)) return C.red;
  if (u === "402") return C.yellow;
  if (u === "PAY") return "#34d399";
  if (u === "---") return C.muted2;
  return C.muted;
};

// ─── Navbar ───────────────────────────────────────────────────────────────────
function Nav({ page, setPage }: { page: Page; setPage: (p: Page) => void }) {
  return (
    <nav style={{ position: "sticky", top: 0, zIndex: 100, background: C.bg + "ee", backdropFilter: "blur(12px)", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", padding: "0 2rem", height: 56 }}>
      <img src="/routefi-both.png" alt="Routefi" style={{ height: 28, cursor: "pointer" }} onClick={() => setPage("landing")} />
      <div style={{ flex: 1 }} />
      {(["landing", "demo", "dashboard"] as Page[]).map(p => (
        p !== "landing" && (
          <button key={p} onClick={() => setPage(p)} style={{
            background: "none", border: "none", color: page === p ? C.text : C.muted,
            fontWeight: page === p ? 600 : 400, fontSize: 14, padding: "0 1rem",
            cursor: "pointer", fontFamily: "inherit", textTransform: "capitalize",
          }}>
            {p}
          </button>
        )
      ))}
      <Btn onClick={() => setPage("demo")} small style={{ marginLeft: "0.5rem" }}>▶ Live Demo</Btn>
    </nav>
  );
}

// ─── LANDING PAGE ─────────────────────────────────────────────────────────────
function Landing({ setPage }: { setPage: (p: Page) => void }) {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => { api.health().then(setHealth).catch(() => {}); }, []);

  const features = [
    { icon: "⚡", title: "x402 Protocol", desc: "HTTP-native micropayments. Any agent that can make HTTP requests can pay automatically — no SDK required." },
    { icon: "🔐", title: "Zero Trust", desc: "Every request requires on-chain proof. No API keys, no subscriptions, no trust required between parties." },
    { icon: "🤖", title: "Agent-Native", desc: "CDP creates a self-custodied EVM wallet. The agent detects 402, signs the payment, and retries — all autonomously." },
    { icon: "📋", title: "Cryptographic Receipts", desc: "Every paid request generates a tamper-proof receipt with the on-chain transaction hash — verifiable forever." },
    { icon: "🛡️", title: "SKALE BITE", desc: "Optional threshold encryption on payment intents before consensus — preventing MEV and front-running attacks." },
    { icon: "⭐", title: "ERC-8004 Reputation", desc: "Gate access by on-chain agent reputation score. Block bad actors before they touch your upstream." },
  ];

  const steps = [
    { n: "1", title: "Register a Route", body: "Define any API endpoint with a price. The gateway proxies it and enforces payment before forwarding." },
    { n: "2", title: "Agent Gets Blocked", body: "Without payment, the gateway returns HTTP 402 with the price, network, and your wallet address encoded in the header." },
    { n: "3", title: "Agent Pays & Gets Data", body: "The SDK reads the 402, signs a USDC transfer on Base, retries with X-Payment — and gets a cryptographic receipt back." },
  ];

  return (
    <div>
      {/* Hero */}
      <section style={{ padding: "5rem 2rem 4rem", textAlign: "center", maxWidth: 800, margin: "0 auto" }}>
        <div style={{ display: "inline-block", background: C.brand + "15", border: `1px solid ${C.brand}33`, borderRadius: 99, padding: "4px 16px", fontSize: 12, fontWeight: 600, color: C.brand, marginBottom: "1.5rem", letterSpacing: "0.06em" }}>
          BUILT ON BASE · x402 PROTOCOL
        </div>
        <h1 style={{ fontSize: "clamp(2rem, 5vw, 3.5rem)", fontWeight: 800, lineHeight: 1.15, marginBottom: "1.25rem" }}>
          Pay-per-request API gateway<br />
          <span style={{ background: grad, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            for AI agents
          </span>
        </h1>
        <p style={{ fontSize: 18, color: C.muted, maxWidth: 560, margin: "0 auto 2rem", lineHeight: 1.7 }}>
          Agents pay USDC on Base for every API call — autonomously, cryptographically, on-chain.
          No subscriptions. No API keys. Pay exactly what you use.
        </p>
        <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}>
          <Btn onClick={() => setPage("demo")}>▶&nbsp; See It Live</Btn>
          <Btn onClick={() => setPage("dashboard")} variant="ghost">Dashboard →</Btn>
        </div>

        {/* Live gateway status pill */}
        {health && (
          <div style={{ marginTop: "2rem", display: "inline-flex", alignItems: "center", gap: 8, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 99, padding: "6px 16px", fontSize: 13, color: C.muted }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.green, display: "inline-block" }} />
            Gateway live · {health.route_count} routes · {health.receipt_count} receipts · Base Sepolia
          </div>
        )}
      </section>

      {/* Flow diagram */}
      <section style={{ padding: "3rem 2rem", maxWidth: 960, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: "2rem" }}>
          <SectionLabel>How It Works</SectionLabel>
          <h2 style={{ fontSize: 24, fontWeight: 700 }}>Three steps. Fully autonomous.</h2>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px,1fr))", gap: "1rem" }}>
          {steps.map((s, i) => (
            <Card key={s.n} style={{ position: "relative", overflow: "hidden" }}>
              <div style={{ fontSize: 32, fontWeight: 900, color: C.brand + "22", position: "absolute", top: 8, right: 16 }}>{s.n}</div>
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: grad, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14, marginBottom: "0.75rem" }}>{s.n}</div>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>{s.title}</div>
              <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.7 }}>{s.body}</div>
              {i < steps.length - 1 && <div style={{ fontSize: 20, color: C.muted2, marginTop: "0.75rem" }}>↓</div>}
            </Card>
          ))}
        </div>
      </section>

      {/* Code snippet */}
      <section style={{ padding: "2rem 2rem", maxWidth: 960, margin: "0 auto" }}>
        <Card style={{ background: "#050508" }}>
          <SectionLabel>Agent SDK — Three Lines to Pay</SectionLabel>
          <pre style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, lineHeight: 1.9, overflowX: "auto", color: "#e2e8f0" }}>{
`import { RequestTapClient } from "@routefi/sdk";

const agent = new RequestTapClient({ gatewayBaseUrl: "http://localhost:4402" });
await agent.init();                              // creates CDP wallet on Base

const res = await agent.request("GET", "/api/v1/posts");
//  ^ detects 402 → signs USDC payment → retries → returns data + receipt

console.log(res.data);                           // upstream response
console.log(res.receipt.payment_tx_hash);        // on-chain proof`
          }</pre>
        </Card>
      </section>

      {/* Features */}
      <section style={{ padding: "3rem 2rem", maxWidth: 960, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: "2rem" }}>
          <SectionLabel>Features</SectionLabel>
          <h2 style={{ fontSize: 24, fontWeight: 700 }}>Built for the agentic web</h2>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px,1fr))", gap: "0.75rem" }}>
          {features.map(f => (
            <Card key={f.title}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>{f.icon}</div>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>{f.title}</div>
              <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.7 }}>{f.desc}</div>
            </Card>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section style={{ padding: "4rem 2rem", textAlign: "center" }}>
        <h2 style={{ fontSize: 28, fontWeight: 700, marginBottom: "0.75rem" }}>See it running live</h2>
        <p style={{ color: C.muted, marginBottom: "1.5rem" }}>Watch an agent pay for real API data on Base Sepolia — every step in your browser.</p>
        <Btn onClick={() => setPage("demo")}>▶&nbsp; Open Live Demo</Btn>
      </section>

      {/* Footer */}
      <footer style={{ borderTop: `1px solid ${C.border}`, padding: "1.5rem 2rem", display: "flex", justifyContent: "space-between", alignItems: "center", color: C.muted2, fontSize: 12 }}>
        <img src="/routefi-both.png" alt="Routefi" style={{ height: 20 }} />
        <span>Built on x402 · Base · Coinbase CDP</span>
      </footer>
    </div>
  );
}

// ─── DEMO PAGE ────────────────────────────────────────────────────────────────
const ACTS = [
  { num: 1, title: "Gateway Live",  sub: "Routes & real-time stats" },
  { num: 2, title: "402 Blocked",   sub: "No payment = no access" },
  { num: 3, title: "Agent Wallet",  sub: "Balance & funding" },
  { num: 4, title: "Agent Pays",    sub: "Autonomous x402 flow" },
  { num: 5, title: "Receipts",      sub: "On-chain proof" },
];

function Demo() {
  const [act, setAct] = useState(1);
  const [agentDone, setAgentDone] = useState(false);

  return (
    <div style={{ display: "flex", height: "calc(100vh - 56px)", overflow: "hidden" }}>
      {/* Sidebar */}
      <aside style={{ width: 210, background: C.surface, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ padding: "1rem", borderBottom: `1px solid ${C.border}`, fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: C.muted2, textTransform: "uppercase" }}>
          Live Demo
        </div>
        <nav style={{ flex: 1, padding: "0.5rem" }}>
          {ACTS.map(a => {
            const active = act === a.num;
            const done = a.num < act || (a.num === 4 && agentDone);
            return (
              <button key={a.num} onClick={() => setAct(a.num)} style={{
                width: "100%", textAlign: "left", border: "none", borderRadius: 8,
                padding: "0.6rem 0.75rem", marginBottom: 2,
                background: active ? C.brand + "18" : "transparent",
                outline: active ? `1px solid ${C.brand}33` : "none",
                cursor: "pointer", display: "flex", alignItems: "center", gap: "0.65rem", fontFamily: "inherit",
              }}>
                <span style={{
                  width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 10, fontWeight: 800,
                  background: done ? C.green + "22" : active ? grad : C.surface2,
                  color: done ? C.green : active ? "#fff" : C.muted2,
                  border: done ? `1px solid ${C.green}44` : "none",
                }}>
                  {done ? "✓" : a.num}
                </span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: active ? 600 : 400, color: active ? C.text : C.muted }}>{a.title}</div>
                  <div style={{ fontSize: 11, color: C.muted2 }}>{a.sub}</div>
                </div>
              </button>
            );
          })}
        </nav>
        <div style={{ padding: "0.75rem 1rem", borderTop: `1px solid ${C.border}`, fontSize: 11, color: C.muted2 }}>
          Base Sepolia · x402
        </div>
      </aside>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "2rem" }}>
        <div style={{ maxWidth: 700, margin: "0 auto" }}>
          {/* Act header */}
          <div style={{ marginBottom: "1.5rem" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.muted2, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>Act {act} of 5</div>
            <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>{ACTS[act-1].title}</h2>
            <p style={{ color: C.muted, fontSize: 14, lineHeight: 1.7 }}>
              {[
                "The Routefi gateway is running on port 4402. Every registered route has a price — no payment header means no access to the upstream API.",
                "Hit the gateway without any payment. See the exact 402 response an agent receives — including the decoded payment requirements in the header.",
                "Paste the agent wallet address to track its USDC and ETH balance live — auto-refreshes every 6 seconds. The Run Agent button unlocks once the wallet is funded.",
                "The agent detects the 402, reads the price and payTo address, signs a USDC transfer on Base Sepolia, and retries with the X-Payment header — fully autonomous.",
                "Every successful payment generates a cryptographic receipt tied to the on-chain transaction. Both parties have verifiable proof.",
              ][act - 1]}
            </p>
          </div>

          {act === 1 && <DemoAct1 />}
          {act === 2 && <DemoAct2 />}
          {act === 3 && <DemoAct3 onNext={() => setAct(4)} />}
          {act === 4 && <DemoAct4 onSuccess={() => setAgentDone(true)} />}
          {act === 5 && <DemoAct5 />}


          <div style={{ display: "flex", gap: "0.75rem", marginTop: "2rem" }}>
            {act > 1 && <Btn onClick={() => setAct(act - 1)} variant="ghost">← Back</Btn>}
            {act < 5 && <Btn onClick={() => setAct(act + 1)} style={{ marginLeft: "auto" }}>Next →</Btn>}
          </div>
        </div>
      </div>
    </div>
  );
}

function DemoAct1() {
  const [health, setHealth] = useState<Health | null>(null);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    const load = () => Promise.all([api.health(), api.routes()])
      .then(([h, r]) => { setHealth(h); setRoutes(r); setErr(""); })
      .catch(() => setErr("Gateway offline — run: node --env-file=.env packages/gateway/dist/index.js"));
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  if (err) return <Card><p style={{ color: C.red }}>{err}</p></Card>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "0.75rem" }}>
        {[
          { label: "Status", value: health?.status === "ok" ? "Online" : "—", color: C.green },
          { label: "Routes", value: health?.route_count ?? "—", color: C.brand },
          { label: "Receipts", value: health?.receipt_count ?? "—", color: "#a78bfa" },
        ].map(s => (
          <Card key={s.label} style={{ textAlign: "center", padding: "1rem" }}>
            <div style={{ fontSize: 26, fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{s.label}</div>
          </Card>
        ))}
      </div>
      <Card>
        <SectionLabel>Routes</SectionLabel>
        {routes.map(r => (
          <div key={r.tool_id} style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.6rem 0", borderBottom: `1px solid ${C.border}` }}>
            <Badge color={C.brand}>{r.method}</Badge>
            <code style={{ flex: 1, fontSize: 13 }}>{r.path}</code>
            <span style={{ color: C.green, fontWeight: 700, fontSize: 13 }}>${r.price_usdc} USDC</span>
            <Badge color={C.muted2}>{r.provider.provider_id}</Badge>
          </div>
        ))}
      </Card>
    </div>
  );
}

function DemoAct2() {
  const [result, setResult] = useState<{ status: number; paymentHeader: string | null; body: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const hit = async () => {
    setLoading(true); setResult(null);
    try {
      const r = await api.rawHit("/api/v1/posts");
      const ph = r.headers.get("payment-required");
      const body = await r.text();
      setResult({ status: r.status, paymentHeader: ph, body });
    } catch { setResult({ status: 0, paymentHeader: null, body: "Could not reach gateway" }); }
    setLoading(false);
  };

  let decoded: object | null = null;
  try { if (result?.paymentHeader) decoded = JSON.parse(atob(result.paymentHeader)); } catch {}

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <Card>
        <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.7, marginBottom: "1rem" }}>
          Clicking the button below sends a real HTTP GET to the gateway — no payment header, no auth. The gateway blocks it before the upstream is ever called.
        </p>
        <Btn onClick={hit} disabled={loading}>
          {loading ? "Sending…" : "▶  Send Request Without Payment"}
        </Btn>
      </Card>

      {result && (
        <Card>
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginBottom: "1rem" }}>
            <Badge color={result.status === 402 ? C.yellow : C.red}>HTTP {result.status}</Badge>
            {result.status === 402 && <span style={{ color: C.yellow, fontWeight: 600 }}>Payment Required — upstream never reached</span>}
          </div>

          {decoded && (
            <>
              <SectionLabel>Payment-Required Header (decoded)</SectionLabel>
              <pre style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, padding: "0.75rem", fontSize: 11.5, overflowX: "auto", color: "#a78bfa", marginBottom: "1rem" }}>
                {JSON.stringify(decoded, null, 2)}
              </pre>
              <p style={{ fontSize: 12, color: C.muted2 }}>
                ↑ The agent reads this — sees the price, network, and payTo address — then pays automatically.
              </p>
            </>
          )}
        </Card>
      )}
    </div>
  );
}

interface WalletBalance { address: string; eth: string; usdc: string; network: string }

function DemoAct3({ onNext }: { onNext: () => void }) {
  const [address, setAddress] = useState(() => localStorage.getItem("agentWallet") || "");
  const [input, setInput] = useState(() => localStorage.getItem("agentWallet") || "");
  const [balance, setBalance] = useState<WalletBalance | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchBalance = useCallback(async (addr: string) => {
    if (!addr || !/^0x[0-9a-fA-F]{40}$/.test(addr)) return;
    setLoading(true); setErr("");
    try {
      const r = await fetch(`/api/wallet-balance?address=${addr}`);
      const d = await r.json();
      if (d.error) { setErr(d.error); setBalance(null); }
      else setBalance(d);
    } catch { setErr("Could not reach RPC"); }
    setLoading(false);
  }, []);

  const save = () => {
    const trimmed = input.trim();
    setAddress(trimmed);
    localStorage.setItem("agentWallet", trimmed);
    fetchBalance(trimmed);
  };

  useEffect(() => {
    if (!address) return;
    fetchBalance(address);
    intervalRef.current = setInterval(() => fetchBalance(address), 6000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [address, fetchBalance]);

  const funded = balance ? parseFloat(balance.usdc) > 0 : false;
  const usdcNeeded = balance ? Math.max(0, 0.003 - parseFloat(balance.usdc)).toFixed(4) : "0.003";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>

      {/* Address input */}
      <Card>
        <SectionLabel>Agent Wallet Address</SectionLabel>
        <p style={{ fontSize: 13, color: C.muted, marginBottom: "0.75rem", lineHeight: 1.6 }}>
          Run the agent first — the wallet address prints on the <code style={{ color: "#60a5fa" }}>[WALLET]</code> line. Paste it here to track the balance live.
        </p>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && save()}
            placeholder="0x..."
            style={{ flex: 1, background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 12px", color: C.text, fontSize: 13, fontFamily: "monospace" }}
          />
          <Btn onClick={save} disabled={!input.trim()}>Track</Btn>
        </div>
        {err && <p style={{ color: C.red, fontSize: 12, marginTop: 6 }}>{err}</p>}
      </Card>

      {/* Live balance */}
      {address && (
        <Card style={{ border: `1px solid ${funded ? C.green + "44" : C.yellow + "44"}` }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
            <SectionLabel>Live Balance · Base Sepolia</SectionLabel>
            {loading && <span style={{ fontSize: 11, color: C.muted2 }}>refreshing…</span>}
            {!loading && <span style={{ fontSize: 11, color: C.muted2 }}>auto-refresh every 6s</span>}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "1rem" }}>
            <div style={{ background: C.surface2, borderRadius: 10, padding: "1rem", textAlign: "center" }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: funded ? C.green : C.yellow }}>
                {balance ? balance.usdc : "—"}
              </div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>USDC</div>
            </div>
            <div style={{ background: C.surface2, borderRadius: 10, padding: "1rem", textAlign: "center" }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: C.text }}>
                {balance ? balance.eth : "—"}
              </div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>ETH (gas)</div>
            </div>
          </div>

          {funded ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0.6rem 1rem", background: C.green + "15", border: `1px solid ${C.green}33`, borderRadius: 8 }}>
              <span style={{ color: C.green, fontWeight: 700 }}>✓ Wallet funded</span>
              <span style={{ color: C.muted, fontSize: 13 }}>— ready to pay for API calls</span>
            </div>
          ) : (
            <div style={{ padding: "0.6rem 1rem", background: C.yellow + "15", border: `1px solid ${C.yellow}33`, borderRadius: 8 }}>
              <div style={{ color: C.yellow, fontWeight: 600, marginBottom: 4 }}>⚠ No USDC yet</div>
              <div style={{ fontSize: 13, color: C.muted }}>Need at least ~{usdcNeeded} USDC to run 3 API calls at $0.001 each.</div>
            </div>
          )}

          <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem" }}>
            <a href={`https://sepolia.basescan.org/address/${address}`} target="_blank" rel="noreferrer"
              style={{ fontSize: 12, color: C.brand }}>View on BaseScan →</a>
            <span style={{ color: C.muted2, fontSize: 12 }}>·</span>
            <button onClick={() => navigator.clipboard.writeText(address)}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: C.muted, fontFamily: "inherit" }}>
              Copy address
            </button>
          </div>
        </Card>
      )}

      {/* Funding instructions */}
      {!funded && (
        <Card>
          <SectionLabel>How to Fund</SectionLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {[
              { n: "1", text: "Go to faucet.circle.com", href: "https://faucet.circle.com" },
              { n: "2", text: "Connect your MetaMask wallet, switch to Base Sepolia" },
              { n: "3", text: "Request test USDC (free, instant)" },
              { n: "4", text: "Send ≥ 0.003 USDC to the agent wallet address above" },
            ].map(s => (
              <div key={s.n} style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start", fontSize: 13 }}>
                <span style={{ width: 20, height: 20, borderRadius: "50%", background: grad, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, flexShrink: 0 }}>{s.n}</span>
                <span style={{ color: C.muted }}>
                  {s.text}
                  {s.href && <> — <a href={s.href} target="_blank" rel="noreferrer" style={{ color: C.brand }}>{s.href}</a></>}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Btn onClick={onNext} style={{ alignSelf: "flex-start" }} disabled={!funded}>
        {funded ? "Run Agent →" : "Fund wallet first"}
      </Btn>
    </div>
  );
}

function DemoAct4({ onSuccess }: { onSuccess: () => void }) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "fail">("idle");
  const termRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  const run = useCallback(() => {
    esRef.current?.close();
    setLines([]); setStatus("idle"); setRunning(true);

    const es = new EventSource("/api/run-agent");
    esRef.current = es;

    es.addEventListener("log", e => {
      const d = JSON.parse(e.data) as LogLine;
      setLines(p => [...p, d]);
      requestAnimationFrame(() => { if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight; });
    });

    es.addEventListener("done", e => {
      const d = JSON.parse(e.data);
      setRunning(false);
      setStatus(d.success ? "success" : "fail");
      if (d.success) onSuccess();
      es.close(); esRef.current = null;
    });

    es.onerror = () => {
      setRunning(false); setStatus("fail");
      setLines(p => [...p, { tag: "ERR", msg: "Connection lost — is the demo server running on port 3001?" }]);
      es.close(); esRef.current = null;
    };
  }, [onSuccess]);

  useEffect(() => () => { esRef.current?.close(); }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <Btn onClick={run} disabled={running}>
          {running ? "⏳  Running…" : lines.length > 0 ? "↺  Run Again" : "▶  Run Agent"}
        </Btn>
        {status === "success" && <Badge color={C.green}>✓ Payments complete</Badge>}
        {status === "fail" && <Badge color={C.red}>✗ Failed — check wallet balance</Badge>}
      </div>

      <div style={{ background: "#04040a", border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
        {/* Terminal bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0.6rem 1rem", background: C.surface, borderBottom: `1px solid ${C.border}` }}>
          {["#ef4444","#f59e0b","#10b981"].map(c => <span key={c} style={{ width: 10, height: 10, borderRadius: "50%", background: c, display: "inline-block" }} />)}
          <span style={{ flex: 1, textAlign: "center", fontSize: 12, color: C.muted2 }}>routefi-agent · Base Sepolia</span>
          {running && <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.green, display: "inline-block", animation: "pulse 1.2s ease-in-out infinite" }} />}
        </div>
        {/* Output */}
        <div ref={termRef} style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace", fontSize: 12.5, lineHeight: 1.8, padding: "1rem", minHeight: 240, maxHeight: 400, overflowY: "auto" }}>
          {lines.length === 0 && !running && <span style={{ color: C.muted2 }}>Click ▶ Run Agent to start…</span>}
          {lines.map((l, i) =>
            l.tag === "---"
              ? <div key={i} style={{ color: "#1e293b", margin: "0.25rem 0" }}>── {l.msg} ──</div>
              : <div key={i}>
                  <span style={{ color: tagColor(l.tag), fontWeight: 700 }}>[{l.tag.padEnd(7)}]</span>
                  {"  "}
                  <span style={{ color: "#cbd5e1" }}>{l.msg}</span>
                </div>
          )}
          {running && <span style={{ color: C.muted2, animation: "blink 1s step-end infinite" }}>█</span>}
        </div>
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
      `}</style>
    </div>
  );
}

function DemoAct5() {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    const load = () => Promise.all([api.receipts(), api.stats()]).then(([r, s]) => { setReceipts(r); setStats(s); }).catch(() => {});
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "0.75rem" }}>
          {[
            { label: "Requests", value: stats.total_requests, color: C.brand },
            { label: "USDC Settled", value: `$${parseFloat(stats.total_usdc || "0").toFixed(4)}`, color: C.green },
            { label: "Success Rate", value: `${stats.success_rate}%`, color: "#a78bfa" },
          ].map(s => (
            <Card key={s.label} style={{ textAlign: "center", padding: "1rem" }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{s.label}</div>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <SectionLabel>Request Receipts</SectionLabel>
        {receipts.length === 0
          ? <p style={{ color: C.muted2, fontSize: 13 }}>No receipts yet — run the agent to generate some.</p>
          : receipts.map(r => (
            <div key={r.request_id} style={{ padding: "0.75rem 0", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: 4 }}>
                <Badge color={outcomeColor(r.outcome)}>{r.outcome}</Badge>
                <code style={{ fontSize: 12, color: C.muted, flex: 1 }}>{r.method} {r.endpoint}</code>
                <span style={{ color: C.green, fontWeight: 700, fontSize: 13 }}>${r.price_usdc}</span>
              </div>
              {r.payment_tx_hash && (
                <div style={{ fontFamily: "monospace", fontSize: 11, color: C.muted2 }}>
                  tx: {r.payment_tx_hash.slice(0, 20)}…{r.payment_tx_hash.slice(-6)}
                </div>
              )}
              <div style={{ fontSize: 11, color: C.muted2 }}>{new Date(r.timestamp).toLocaleTimeString()}</div>
            </div>
          ))
        }
      </Card>
    </div>
  );
}

// ─── DASHBOARD PAGE ───────────────────────────────────────────────────────────
function Dashboard() {
  const [health, setHealth] = useState<Health | null>(null);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [tab, setTab] = useState<"routes" | "receipts">("routes");
  const [showAdd, setShowAdd] = useState(false);
  const [newRoute, setNewRoute] = useState({ method: "GET", path: "", price_usdc: "0.001", tool_id: "", provider_id: "", backend_url: "", description: "" });
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("ALL");
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const [h, r, rc, s] = await Promise.all([api.health(), api.routes(), api.receipts(), api.stats()]);
      setHealth(h); setRoutes(r); setReceipts(rc); setStats(s); setErr("");
    } catch { setErr("Gateway offline"); }
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [load]);

  const handleAdd = async () => {
    if (!newRoute.path || !newRoute.tool_id || !newRoute.backend_url) return;
    setSaving(true);
    await api.addRoute({
      method: newRoute.method, path: newRoute.path, tool_id: newRoute.tool_id,
      price_usdc: newRoute.price_usdc, description: newRoute.description,
      provider: { provider_id: newRoute.provider_id || newRoute.tool_id, backend_url: newRoute.backend_url },
    });
    await load();
    setShowAdd(false);
    setNewRoute({ method: "GET", path: "", price_usdc: "0.001", tool_id: "", provider_id: "", backend_url: "", description: "" });
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm(`Remove route ${id}?`)) return;
    await api.deleteRoute(id);
    await load();
  };

  const handleClearReceipts = async () => {
    if (!confirm("Clear all receipts?")) return;
    await api.clearReceipts();
    await load();
  };

  const shown = filter === "ALL" ? receipts : receipts.filter(r => r.outcome === filter);

  const inputStyle: React.CSSProperties = { background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 10px", color: C.text, fontSize: 13, fontFamily: "inherit", width: "100%" };

  return (
    <div style={{ padding: "2rem", maxWidth: 1000, margin: "0 auto" }}>
      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: "1.5rem" }}>Gateway Dashboard</h2>

      {err && <Card style={{ borderColor: C.red + "44", color: C.red, marginBottom: "1rem" }}>{err}</Card>}

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: "0.75rem", marginBottom: "1.5rem" }}>
        {[
          { label: "Status", value: health?.status === "ok" ? "Online" : "Offline", color: health?.status === "ok" ? C.green : C.red },
          { label: "Uptime", value: health?.uptime_human ?? "—", color: C.text },
          { label: "Routes", value: stats ? routes.length : "—", color: C.brand },
          { label: "Total Requests", value: stats?.total_requests ?? "—", color: C.brand },
          { label: "Success Rate", value: stats ? `${stats.success_rate}%` : "—", color: C.green },
          { label: "USDC Settled", value: stats ? `$${parseFloat(stats.total_usdc || "0").toFixed(4)}` : "—", color: C.green },
        ].map(s => (
          <Card key={s.label} style={{ padding: "0.875rem" }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 11, color: C.muted2, marginTop: 2 }}>{s.label}</div>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: "1rem", borderBottom: `1px solid ${C.border}`, paddingBottom: "0.5rem" }}>
        {(["routes", "receipts"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            background: tab === t ? C.brand + "22" : "none", border: "none",
            borderRadius: 8, padding: "6px 16px", cursor: "pointer", fontFamily: "inherit",
            color: tab === t ? C.brand : C.muted, fontWeight: tab === t ? 600 : 400, fontSize: 13,
            outline: tab === t ? `1px solid ${C.brand}33` : "none",
          }}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
            {t === "receipts" && receipts.length > 0 && (
              <span style={{ marginLeft: 6, background: C.brand + "33", color: C.brand, borderRadius: 99, padding: "1px 7px", fontSize: 11 }}>{receipts.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Routes tab */}
      {tab === "routes" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Btn onClick={() => setShowAdd(v => !v)} small>{showAdd ? "✕ Cancel" : "+ Add Route"}</Btn>
          </div>

          {showAdd && (
            <Card>
              <SectionLabel>New Route</SectionLabel>
              <div style={{ display: "grid", gridTemplateColumns: "100px 1fr 120px", gap: "0.5rem", marginBottom: "0.5rem" }}>
                <select value={newRoute.method} onChange={e => setNewRoute(p => ({ ...p, method: e.target.value }))} style={{ ...inputStyle }}>
                  {["GET","POST","PUT","DELETE","PATCH"].map(m => <option key={m}>{m}</option>)}
                </select>
                <input placeholder="/api/v1/resource" value={newRoute.path} onChange={e => setNewRoute(p => ({ ...p, path: e.target.value }))} style={inputStyle} />
                <input placeholder="Price USDC" value={newRoute.price_usdc} onChange={e => setNewRoute(p => ({ ...p, price_usdc: e.target.value }))} style={inputStyle} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", marginBottom: "0.5rem" }}>
                <input placeholder="Tool ID (e.g. list-posts)" value={newRoute.tool_id} onChange={e => setNewRoute(p => ({ ...p, tool_id: e.target.value }))} style={inputStyle} />
                <input placeholder="Provider ID (e.g. jsonplaceholder)" value={newRoute.provider_id} onChange={e => setNewRoute(p => ({ ...p, provider_id: e.target.value }))} style={inputStyle} />
              </div>
              <input placeholder="Backend URL (e.g. https://jsonplaceholder.typicode.com)" value={newRoute.backend_url} onChange={e => setNewRoute(p => ({ ...p, backend_url: e.target.value }))} style={{ ...inputStyle, marginBottom: "0.5rem" }} />
              <input placeholder="Description (optional)" value={newRoute.description} onChange={e => setNewRoute(p => ({ ...p, description: e.target.value }))} style={{ ...inputStyle, marginBottom: "0.75rem" }} />
              <Btn onClick={handleAdd} disabled={saving} small>{saving ? "Saving…" : "Add Route"}</Btn>
            </Card>
          )}

          <Card>
            {routes.length === 0
              ? <p style={{ color: C.muted2, fontSize: 13 }}>No routes registered.</p>
              : routes.map(r => (
                <div key={r.tool_id} style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.75rem 0", borderBottom: `1px solid ${C.border}` }}>
                  <Badge color={C.brand}>{r.method}</Badge>
                  <div style={{ flex: 1 }}>
                    <code style={{ fontSize: 13 }}>{r.path}</code>
                    {r.description && <div style={{ fontSize: 11, color: C.muted2 }}>{r.description}</div>}
                  </div>
                  <span style={{ color: C.green, fontWeight: 700, fontSize: 13 }}>${r.price_usdc}</span>
                  <Badge color={C.muted2}>{r.provider.provider_id}</Badge>
                  <Btn onClick={() => handleDelete(r.tool_id)} variant="danger" small>Remove</Btn>
                </div>
              ))
            }
          </Card>
        </div>
      )}

      {/* Receipts tab */}
      {tab === "receipts" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            {["ALL","SUCCESS","DENIED","ERROR"].map(f => (
              <button key={f} onClick={() => setFilter(f)} style={{
                background: filter === f ? C.brand + "22" : "none", border: `1px solid ${filter === f ? C.brand + "44" : C.border}`,
                borderRadius: 6, padding: "3px 12px", cursor: "pointer", fontFamily: "inherit",
                color: filter === f ? C.brand : C.muted, fontSize: 12, fontWeight: filter === f ? 700 : 400,
              }}>{f}</button>
            ))}
            <div style={{ flex: 1 }} />
            {receipts.length > 0 && <Btn onClick={handleClearReceipts} variant="danger" small>Clear All</Btn>}
          </div>

          <Card>
            {shown.length === 0
              ? <p style={{ color: C.muted2, fontSize: 13 }}>No receipts{filter !== "ALL" ? ` with outcome ${filter}` : ""}.</p>
              : shown.map(r => (
                <div key={r.request_id} style={{ padding: "0.75rem 0", borderBottom: `1px solid ${C.border}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: 4 }}>
                    <Badge color={outcomeColor(r.outcome)}>{r.outcome}</Badge>
                    <code style={{ fontSize: 12, color: C.muted, flex: 1 }}>{r.method} {r.endpoint}</code>
                    <span style={{ color: C.green, fontWeight: 700, fontSize: 13 }}>${r.price_usdc}</span>
                  </div>
                  {r.payment_tx_hash && (
                    <div style={{ fontFamily: "monospace", fontSize: 11, color: C.muted2, marginBottom: 2 }}>
                      tx: {r.payment_tx_hash}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: C.muted2 }}>{r.tool_id} · {new Date(r.timestamp).toLocaleString()}</div>
                  {r.explanation && <div style={{ fontSize: 11, color: C.muted2 }}>{r.explanation}</div>}
                </div>
              ))
            }
          </Card>
        </div>
      )}
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [page, setPage] = useState<Page>("landing");

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text }}>
      <Nav page={page} setPage={setPage} />
      {page === "landing"   && <Landing setPage={setPage} />}
      {page === "demo"      && <Demo />}
      {page === "dashboard" && <Dashboard />}
    </div>
  );
}
