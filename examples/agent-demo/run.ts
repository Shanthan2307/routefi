import { RequestTapClient as RoutefiClient } from "@routefi/sdk";
import { writeFileSync } from "fs";

const GATEWAY_URL = process.env.RT_GATEWAY_URL || "http://localhost:4402";

function log(tag: string, msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] [${tag}] ${msg}`);
}

async function main() {
  console.log("=== Routefi Agent Demo ===\n");

  const client = new RoutefiClient({ gatewayBaseUrl: GATEWAY_URL });

  log("INIT", "Creating CDP wallet on Base Sepolia...");
  await client.init();
  log("WALLET", `Agent wallet: ${client.getWalletAddress()}`);
  console.log();

  // --- Call 1: GET /api/v1/posts ---
  log("REQUEST", "GET /api/v1/posts");
  try {
    const res1 = await client.request("GET", "/api/v1/posts");
    log(res1.status === 200 ? "200 OK" : String(res1.status),
      res1.receipt?.outcome === "SUCCESS"
        ? `Data received — ${Array.isArray(res1.data) ? res1.data.length : 1} posts`
        : `Outcome: ${res1.receipt?.outcome} — ${res1.receipt?.explanation}`
    );
    if (res1.receipt) log("RECEIPT", `${res1.receipt.request_id} | tx: ${res1.receipt.payment_tx_hash || "none"}`);
  } catch (err) {
    log("ERROR", String(err));
  }
  console.log();

  // --- Call 2: GET /api/v1/posts/1 ---
  log("REQUEST", "GET /api/v1/posts/1");
  try {
    const res2 = await client.request("GET", "/api/v1/posts/1");
    log(res2.status === 200 ? "200 OK" : String(res2.status),
      res2.receipt?.outcome === "SUCCESS"
        ? `Post received — title: "${(res2.data as any)?.title?.slice(0, 40)}..."`
        : `Outcome: ${res2.receipt?.outcome}`
    );
    if (res2.receipt) log("RECEIPT", `${res2.receipt.request_id} | tx: ${res2.receipt.payment_tx_hash || "none"}`);
  } catch (err) {
    log("ERROR", String(err));
  }
  console.log();

  // --- Call 3: GET /api/v1/users ---
  log("REQUEST", "GET /api/v1/users");
  try {
    const res3 = await client.request("GET", "/api/v1/users");
    log(res3.status === 200 ? "200 OK" : String(res3.status),
      res3.receipt?.outcome === "SUCCESS"
        ? `Data received — ${Array.isArray(res3.data) ? res3.data.length : 1} users`
        : `Outcome: ${res3.receipt?.outcome}`
    );
    if (res3.receipt) log("RECEIPT", `${res3.receipt.request_id} | tx: ${res3.receipt.payment_tx_hash || "none"}`);
  } catch (err) {
    log("ERROR", String(err));
  }
  console.log();

  // --- Summary ---
  console.log("=== Spend Summary ===");
  log("TOTAL", `Spent: ${client.getTotalSpent().toFixed(4)} USDC | Receipts: ${client.getReceipts().length}`);

  const receiptsJson = client.dumpReceipts();
  writeFileSync("receipts.json", receiptsJson);
  log("DONE", "Receipts written to receipts.json ✓");
}

main().catch(console.error);
