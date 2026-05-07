# Contributing to Routefi Router

Thank you for your interest in contributing to Routefi Router! This guide will help you get started.

## Reporting Bugs

Open an issue on [GitHub Issues](https://github.com/Routefi/Routefi-Router/issues) with:

- A clear, descriptive title
- Steps to reproduce the bug
- Expected vs actual behavior
- Node.js version, OS, and any relevant environment details
- Relevant log output or error messages

## Suggesting Features

Open a [GitHub Issue](https://github.com/Routefi/Routefi-Router/issues) with the **feature** label. Describe:

- The problem your feature would solve
- Your proposed solution
- Any alternatives you've considered

## Development Setup

```bash
# Clone the repo
git clone https://github.com/Routefi/Routefi-Router.git
cd Routefi-Router

# Install dependencies
npm install

# Build all workspaces
npm run build

# Run tests
npm test
```

See the [README](README.md) for full setup instructions including environment variables and route configuration.

## Pull Request Process

1. **Fork** the repository and create a branch from `main`
2. **Make your changes** — keep PRs focused on a single concern
3. **Write tests** for new functionality
4. **Run the full test suite** — `npm test`
5. **Open a PR** against `main` with a clear description of the change

## Code Style

- **ESM** (`import`/`export`) throughout — no CommonJS
- **TypeScript** with `NodeNext` module resolution
- Follow existing patterns in the codebase
- Use `.js` extensions in import paths (required by NodeNext)

## Project Structure

This is an npm workspaces monorepo. See the [README](README.md#monorepo-structure) for a breakdown of each package.

| Workspace | Purpose |
|-----------|---------|
| `packages/shared` | Types, schemas, constants |
| `packages/gateway` | Express HTTP gateway |
| `packages/sdk` | Agent client SDK |
| `dashboard` | Admin dashboard |
| `examples/agent-demo` | Demo script |

## Questions?

Open an issue or email [support@routefi.ai](mailto:support@routefi.ai).
