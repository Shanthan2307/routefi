# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2025-06-XX

### Added

- x402 payment pipeline on Base (USDC) with Coinbase CDP facilitator
- AP2 mandate enforcement — spend caps, tool allowlists, expiry, EIP-191 signature verification
- Replay protection via idempotency key + request hash deduplication
- SSRF protection — blocks private/reserved IP ranges at route compile time
- x402 upstream detection — rejects routes that already speak x402 to prevent markup abuse
- Agent blacklist — block specific agent addresses from using the gateway
- API key authentication for gateway routes
- Rate limiting (100 req/min per IP via express-rate-limit)
- Security headers (helmet + CORS middleware)
- Optional SKALE BITE threshold encryption for premium intents
- Structured JSON receipts for every request (SUCCESS, DENIED, ERROR, REFUNDED)
- Agent SDK (`@routefi/sdk`) with automatic x402 payment handling
- Admin dashboard with route management, receipt viewer, and debug tools
- OpenAPI spec generation for registered routes
- Admin API for routes, receipts, blacklist, spend tracking, and config management
- Claude Code slash commands for common dev workflows
