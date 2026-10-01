# Acme Remit for Alexa+

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

Phase 0 — setup. See the phase plan in `docs/SPEC.md`.

## Run (from Phase 1)

```bash
pnpm install
cp .env.example .env
pnpm db:migrate && pnpm db:seed
pnpm dev
# MCP endpoint: POST http://127.0.0.1:3000/mcp  (Bearer token from .env)
```

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
