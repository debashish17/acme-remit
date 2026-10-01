# Acme Remit for Alexa+

[![CI](https://github.com/debashish17/acme-remit/actions/workflows/ci.yml/badge.svg)](https://github.com/debashish17/acme-remit/actions/workflows/ci.yml)

> **Simulated ledger — no real funds move.** Mid-market exchange rates are live (ECB via Frankfurter, cached); Acme pricing, limits, card funding, screening and payout are simulated.

A self-hosted [MCP](https://modelcontextprotocol.io) server (spec 2025-11-25, Streamable HTTP) that lets Alexa+ handle UAE→India remittances safely, plus a web simulator that stands in for Alexa+.

Built for the **Alexa+ track** of [Build, Ship, Shape: Amazon Developer Hackathon](https://amazonappdev2026.devpost.com/) (Devpost), with the AWS Builder and Open Source mini challenges.

## What it does

One remittance provider's own Alexa+ add-on. A customer in Dubai can ask for today's rate, compare payout methods, send money to a saved recipient, track it to the UTR, cancel before payout, check limits, and set a rate alert — by voice.

Three safety properties hold for every money movement:

1. **Read-back before action.** `prepare_transfer` returns the exact sentence to read back; nothing moves until the user agrees.
2. **Single-use, expiring tokens.** `confirm_transfer` and `cancel_transfer` only execute with a 5-minute, session-bound, single-use token.
3. **Server-side limits.** KYC-tier, daily, monthly and cash-pickup caps are enforced in core, not by the model.

## Spec

`docs/SPEC.md` is the build contract: decisions, architecture, the 12-tool contract with JSON schemas, core module interfaces, data model and seed, token lifecycle and tests, simulator design, and the phase plan. The architecture, transfer-lifecycle and timeline diagrams live in the source doc and are not in the Markdown export.

## Status

Phase 1 — protocol skeleton. Streamable HTTP on `POST /mcp` (stateless, Bearer auth), `GET /health`, SQLite schema with migrate and seed scripts, and one tool, `get_rate`, returning a fixed example rate. The other eleven tools arrive in Phase 2. See the phase plan in `docs/SPEC.md`.

## Run

```bash
pnpm install
cp .env.example .env
pnpm db:migrate && pnpm db:seed
pnpm dev
# MCP endpoint: POST http://127.0.0.1:3000/mcp  (Bearer token from .env)
```

`pnpm test`, `pnpm lint` and `pnpm typecheck` are what CI runs. `pnpm db:seed` wipes and reloads the demo data, so every run starts identical.

### Check the protocol with curl

```bash
export MCP_BEARER_TOKEN=change-me-to-a-long-random-string   # the value in your .env
curl -s http://127.0.0.1:3000/mcp \
  -H "Authorization: Bearer $MCP_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
```

Expected: `"protocolVersion":"2025-11-25"` and `"serverInfo":{"name":"acme-remit",...}`. Without the `Authorization` header the server answers `401`. Legacy `GET /sse` is not served.

## Real vs simulated

| Component | Real | Simulated |
| --- | --- | --- |
| MCP server, Streamable HTTP, spec 2025-11-25 | yes | |
| Bearer auth, token lifecycle, limit enforcement | yes | |
| AWS App Runner deployment, Bedrock in the client | yes | |
| Mid-market exchange rates | yes (Frankfurter) | |
| Acme FX margin, fees, payout methods, KYC tier limits | | yes |
| Card funding, ledger, screening, payout partner, UTRs | | yes |

## License

MIT — see `LICENSE`.
