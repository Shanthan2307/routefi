# Security Policy

## Reporting Vulnerabilities

**Please do not open public GitHub issues for security vulnerabilities.**

Email [support@routefi.ai](mailto:support@routefi.ai) with:

- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested fixes (optional)

## Scope

The following components are in scope:

- **Gateway** (`packages/gateway`) — middleware pipeline, payment flow, proxy
- **SDK** (`packages/sdk`) — agent client, payment handling
- **Dashboard** (`dashboard`) — admin UI, API proxy
- **Contracts** (`contracts/`) — SKALE BITE Solidity

## Response Timeline

- **Acknowledgment:** within 48 hours
- **Initial assessment:** within 5 business days
- **Critical issues:** aim to resolve within 7 days

## What Qualifies

- Payment bypass or manipulation
- Authentication/authorization bypass (admin API, API key auth)
- SSRF or request smuggling
- Injection vulnerabilities (SQL, command, header)
- Private key or secret exposure
- Replay protection bypass
- Mandate enforcement bypass (spend caps, allowlists, expiry)
- Cross-site scripting (XSS) in the dashboard

## Recognition

We appreciate responsible disclosure and will credit reporters in the changelog (unless you prefer to remain anonymous).
