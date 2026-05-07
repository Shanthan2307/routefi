import { x402ResourceServer, x402HTTPResourceServer, ExpressAdapter } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import type { RoutesConfig } from "@x402/core/server";
import type { Request, Response, NextFunction } from "express";
import type { GatewayConfig } from "../config.js";
import type { RouteRule } from "../routing.js";
import { logger } from "../utils/logger.js";
import { generateJwt } from "@coinbase/cdp-sdk/auth";

const NETWORK_MAP: Record<string, `${string}:${string}`> = {
  "base-sepolia": "eip155:84532",
  "base": "eip155:8453",
  "base-mainnet": "eip155:8453",
};

export function toCAIP2Network(network: string): `${string}:${string}` {
  return NETWORK_MAP[network] ?? (`eip155:${network}` as `${string}:${string}`);
}

function buildRoutesConfig(rules: RouteRule[], config: GatewayConfig): RoutesConfig {
  const network = toCAIP2Network(config.baseNetwork);
  const routes: Record<string, unknown> = {};

  for (const rule of rules) {
    const price = parseFloat(rule.price_usdc);
    if (price <= 0) continue;

    // Convert :param to * for x402 route matching
    const x402Path = rule.path.replace(/:[\w]+/g, "*");
    const key = `${rule.method.toUpperCase()} ${x402Path}`;

    routes[key] = {
      accepts: [
        {
          scheme: "exact",
          price: `$${rule.price_usdc}`,
          network,
          payTo: config.payToAddress,
        },
      ],
      description: `${rule.tool_id} via ${rule.provider.provider_id}`,
      mimeType: "application/json",
    };
  }

  return routes as RoutesConfig;
}

export interface SettlementResult {
  txHash: string | null;
  network: string | null;
  payer: string | null;
}

export interface PaymentSystem {
  middleware: (req: Request, res: Response, next: NextFunction) => Promise<void>;
  settle: (req: Request) => Promise<SettlementResult>;
  addRoute: (rule: RouteRule) => void;
  removeRoute: (rule: RouteRule) => void;
  /** CAIP-2 network the payment system was initialized for (e.g. "eip155:84532") */
  getNetwork: () => string;
  /** Human-readable network name (e.g. "base-sepolia") */
  getNetworkName: () => string;
}

export function createPaymentSystem(
  config: GatewayConfig,
  routes: RouteRule[],
): PaymentSystem {
  const routesConfig = buildRoutesConfig(routes, config);

  // Capture the network at init time — dashboard config may mutate config.baseNetwork
  // later, but the facilitator is initialized for this specific network only.
  const initNetwork = toCAIP2Network(config.baseNetwork);
  const initNetworkName = config.baseNetwork;

  // If no paid routes, return pass-through (but still allow dynamic route addition)
  if (Object.keys(routesConfig).length === 0) {
    const noopAdd = () => {};
    const noopRemove = () => {};
    return {
      middleware: async (_req, _res, next) => {
        next();
      },
      settle: async () => ({ txHash: null, network: null, payer: null }),
      addRoute: noopAdd,
      removeRoute: noopRemove,
      getNetwork: () => initNetwork,
      getNetworkName: () => initNetworkName,
    };
  }

  const facilitatorConfig: {
    url: string;
    createAuthHeaders?: () => Promise<{
      verify: Record<string, string>;
      settle: Record<string, string>;
      supported: Record<string, string>;
    }>;
  } = {
    url: config.facilitatorUrl,
  };

  // CDP facilitator requires JWT auth
  if (config.cdpApiKeyId && config.cdpApiKeySecret) {
    const apiKeyId = config.cdpApiKeyId;
    const apiKeySecret = config.cdpApiKeySecret;
    const facilitatorHost = new URL(config.facilitatorUrl).host;

    facilitatorConfig.createAuthHeaders = async () => {
      const makeHeader = async (method: string, path: string) => {
        const token = await generateJwt({
          apiKeyId,
          apiKeySecret,
          requestMethod: method,
          requestHost: facilitatorHost,
          requestPath: path,
        });
        return { Authorization: `Bearer ${token}` };
      };
      const basePath = new URL(config.facilitatorUrl).pathname.replace(/\/$/, "");
      return {
        verify: await makeHeader("POST", `${basePath}/verify`),
        settle: await makeHeader("POST", `${basePath}/settle`),
        supported: await makeHeader("GET", `${basePath}/supported`),
      };
    };
  }

  const facilitator = new HTTPFacilitatorClient(facilitatorConfig);
  const resourceServer = new x402ResourceServer(facilitator);
  registerExactEvmScheme(resourceServer);

  const httpServer = new x402HTTPResourceServer(resourceServer, routesConfig);

  let initPromise: Promise<void> | null = httpServer
    .initialize()
    .catch((err) => {
      logger.warn("x402 initialization failed, payments may not work", {
        error: String(err),
      });
    });

  const middleware = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    if (initPromise) {
      await initPromise;
      initPromise = null;
    }

    const adapter = new ExpressAdapter(req);
    const context = {
      adapter,
      path: adapter.getPath(),
      method: adapter.getMethod(),
      paymentHeader: adapter.getHeader("x-payment") ?? adapter.getHeader("payment"),
    };

    const requires = httpServer.requiresPayment(context);
    if (!requires) {
      next();
      return;
    }

    try {
      const result = await httpServer.processHTTPRequest(context);

      switch (result.type) {
        case "no-payment-required":
          next();
          return;

        case "payment-error": {
          const { status, headers, body, isHtml } = result.response;
          res.status(status);
          for (const [k, v] of Object.entries(headers)) {
            res.setHeader(k, v);
          }
          if (isHtml) {
            res.send(body);
          } else {
            res.json(body ?? {});
          }
          return;
        }

        case "payment-verified":
          (req as any).x402Verified = true;
          (req as any).x402PaymentPayload = result.paymentPayload;
          (req as any).x402PaymentRequirements = result.paymentRequirements;
          (req as any).x402DeclaredExtensions = result.declaredExtensions;
          next();
          return;
      }
    } catch (err) {
      logger.error("Payment middleware error", { error: String(err) });
      next();
    }
  };

  const settle = async (req: Request): Promise<SettlementResult> => {
    if (!(req as any).x402Verified) {
      return { txHash: null, network: null, payer: null };
    }

    try {
      const result = await httpServer.processSettlement(
        (req as any).x402PaymentPayload,
        (req as any).x402PaymentRequirements,
        (req as any).x402DeclaredExtensions,
      );

      if (result.success) {
        return {
          txHash: result.transaction || null,
          network: result.network || null,
          payer: result.payer || null,
        };
      }

      logger.warn("Payment settlement failed", {
        error: (result as any).errorReason,
        message: (result as any).errorMessage,
      });
      return { txHash: null, network: null, payer: null };
    } catch (err) {
      logger.error("Payment settlement error", { error: String(err) });
      return { txHash: null, network: null, payer: null };
    }
  };

  // Dynamic route management — pushes/removes from x402's internal compiledRoutes
  const addRoute = (rule: RouteRule) => {
    const price = parseFloat(rule.price_usdc);
    if (price <= 0) return;
    const x402Path = rule.path.replace(/:[\w]+/g, "*");
    const key = `${rule.method.toUpperCase()} ${x402Path}`;
    const routeConfig = {
      accepts: [{
        scheme: "exact",
        price: `$${rule.price_usdc}`,
        network: initNetwork, // Use init-time network, not current config
        payTo: config.payToAddress,
      }],
      description: `${rule.tool_id} via ${rule.provider.provider_id}`,
      mimeType: "application/json",
    };
    // Update routesConfig object
    (routesConfig as any)[key] = routeConfig;
    // Push compiled route into x402's internal array so requiresPayment() sees it
    const parsed = (httpServer as any).parseRoutePattern(key);
    (httpServer as any).compiledRoutes.push({
      verb: parsed.verb,
      regex: parsed.regex,
      config: routeConfig,
    });
  };

  const removeRoute = (rule: RouteRule) => {
    const x402Path = rule.path.replace(/:[\w]+/g, "*");
    const key = `${rule.method.toUpperCase()} ${x402Path}`;
    delete (routesConfig as any)[key];
    // Remove from x402's compiled routes
    const parsed = (httpServer as any).parseRoutePattern(key);
    const regexStr = parsed.regex.toString();
    (httpServer as any).compiledRoutes = (httpServer as any).compiledRoutes.filter(
      (r: any) => !(r.verb === parsed.verb && r.regex.toString() === regexStr),
    );
  };

  return { middleware, settle, addRoute, removeRoute, getNetwork: () => initNetwork, getNetworkName: () => initNetworkName };
}
