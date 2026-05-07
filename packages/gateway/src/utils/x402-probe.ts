import { logger } from "./logger.js";

export class X402UpstreamError extends Error {
  constructor(url: string) {
    super(
      `Upstream already supports x402 payments: ${url} — wrapping x402 endpoints is not allowed`,
    );
    this.name = "X402UpstreamError";
  }
}

/**
 * Probes an upstream URL to detect if it already speaks the x402 payment
 * protocol. If the upstream returns 402 with a `payment-required` header,
 * registration is blocked to prevent markup/middleman abuse.
 *
 * Network errors, timeouts, and non-402 responses are silently ignored so
 * that route registration is not blocked when the upstream is simply down.
 */
export async function assertNotX402Upstream(
  backendUrl: string,
  routePath: string,
): Promise<void> {
  if (process.env.RT_SKIP_X402_PROBE === "true") return;

  // Replace :param segments with a placeholder so we hit a real-ish path
  const probePath = routePath.replace(/:[^/]+/g, "__probe__");
  const url = backendUrl.replace(/\/+$/, "") + probePath;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "Routefi-x402-probe/1.0" },
    });
    clearTimeout(timeout);

    if (
      res.status === 402 &&
      res.headers.has("payment-required")
    ) {
      throw new X402UpstreamError(url);
    }
  } catch (err) {
    // Re-throw our own error; swallow everything else
    if (err instanceof X402UpstreamError) throw err;
    logger.debug(`x402 probe failed for ${url} (non-fatal): ${err}`);
  }
}
