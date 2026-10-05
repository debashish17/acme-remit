# Security policy

## Reporting a vulnerability

Please report it privately through GitHub: **Security → Report a vulnerability** on this repository. Don't open a public issue. You'll get a reply within a week.

## Scope

- **In scope:**
  - the MCP server (`src/server`, `src/core`): authentication, the confirmation and step-up rules, limits, and the simulator's routes and MCP Apps host
  - the [`mcp-confirm-gate`](packages/mcp-confirm-gate) package
  - the CloudFormation template and the deploy workflow
- **Out of scope:**
  - the simulated ledger's own figures (no real money moves)
  - the hosted simulator's access code being shared with judges (see the README threat model)
  - findings that need a compromised machine

## Supported versions

| Component | Supported |
| --- | --- |
| This repository | `main` |
| `mcp-confirm-gate` | 0.2.0 and later. 0.1.0 is deprecated: it did not count parallel wrong codes (see its CHANGELOG) |
