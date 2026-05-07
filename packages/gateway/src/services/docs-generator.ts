import type { RouteRule } from "../routing.js";
import type { RouteGroup } from "./config-store.js";

export interface DocsMetadata {
  title?: string;
  description?: string;
  baseUrl: string;
  payToAddress: string;
}

/** Title-case a provider_id like "acme-data" → "Acme Data" */
function formatProviderName(providerId: string): string {
  return providerId
    .split(/[-_]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Derive a human-readable provider label from routes' provider_id values. */
function deriveProviderName(routes: RouteRule[]): string | null {
  const ids = new Set<string>();
  for (const r of routes) {
    if (!r.restricted && r.provider?.provider_id) {
      ids.add(r.provider.provider_id);
    }
  }
  if (ids.size === 0) return null;
  const names = [...ids].map(formatProviderName);
  return names.join(", ");
}

export function generateAgentApiDocs(
  routes: RouteRule[],
  groups: RouteGroup[],
  meta: DocsMetadata,
): object {
  // Derive provider-based title/description when not explicitly provided
  const providerName = deriveProviderName(routes);
  const title =
    meta.title ||
    (providerName ? `${providerName} (x402 Agent API)` : "Routefi API");
  const description =
    meta.description ||
    (providerName
      ? `${providerName} — AI Agent API powered by Routefi x402 Payment Gateway`
      : "AI Agent API powered by Routefi x402 Payment Gateway");

  // Build group lookup: toolId -> group
  const toolGroupMap = new Map<string, RouteGroup>();
  for (const group of groups) {
    for (const toolId of group.toolIds) {
      toolGroupMap.set(toolId, group);
    }
  }

  // Build tags from groups
  const tags: { name: string; description: string }[] = [];
  const seenTags = new Set<string>();

  for (const group of groups) {
    if (!seenTags.has(group.name)) {
      tags.push({ name: group.name, description: group.description });
      seenTags.add(group.name);
    }
  }

  // Check if any routes are ungrouped
  const hasUngrouped = routes.some((r) => !r.restricted && !toolGroupMap.has(r.tool_id));
  if (hasUngrouped) {
    tags.push({ name: "Ungrouped", description: "Routes not assigned to a group" });
  }

  // Build paths (exclude restricted routes)
  const paths: Record<string, Record<string, object>> = {};
  const allowedRoutes = routes.filter((r) => !r.restricted);

  for (const route of allowedRoutes) {
    const group = toolGroupMap.get(route.tool_id);
    const tagName = group ? group.name : "Ungrouped";
    const price = group?.priceUsdc || route.price_usdc;

    const pathKey = route.path;
    if (!paths[pathKey]) paths[pathKey] = {};

    paths[pathKey][route.method.toLowerCase()] = {
      tags: [tagName],
      summary: route.description || `${route.method} ${route.path}`,
      operationId: route.tool_id,
      "x-routefi-tool-id": route.tool_id,
      "x-routefi-price": price,
      parameters: extractPathParams(route.path),
      responses: {
        "200": { description: "Successful response" },
        "402": { description: "Payment Required — x402 payment header missing or invalid" },
        "404": { description: "Route not found" },
      },
    };
  }

  return {
    openapi: "3.0.3",
    info: {
      title,
      description,
      version: "1.0.0",
      "x-routefi-pay-to": meta.payToAddress,
    },
    servers: [{ url: meta.baseUrl }],
    tags,
    paths,
    components: {
      securitySchemes: {
        x402Payment: {
          type: "apiKey",
          in: "header",
          name: "X-PAYMENT",
          description:
            "x402 payment header. Contains a base64-encoded JSON payment object with payment proof for the requested resource.",
        },
        mandate: {
          type: "apiKey",
          in: "header",
          name: "X-MANDATE",
          description:
            "Base64-encoded JSON mandate object authorizing the agent to spend on behalf of the user.",
        },
      },
    },
    security: [{ x402Payment: [] }],
  };
}

function extractPathParams(path: string): object[] {
  const params: object[] = [];
  const segments = path.split("/");
  for (const seg of segments) {
    if (seg.startsWith(":")) {
      params.push({
        name: seg.slice(1),
        in: "path",
        required: true,
        schema: { type: "string" },
      });
    }
  }
  return params;
}
