# Acme Remit for Alexa+

[![CI](https://github.com/debashish17/acme-remit/actions/workflows/ci.yml/badge.svg)](https://github.com/debashish17/acme-remit/actions/workflows/ci.yml)

> **Simulated ledger — no real funds move.** Mid-market exchange rates are live (ECB via Frankfurter, cached; AED/INR derived from USD/INR at the 3.6725 AED/USD peg); Acme pricing, limits, card funding, screening and payout are simulated.

A self-hosted [MCP](https://modelcontextprotocol.io) server (spec 2025-11-25, Streamable HTTP) that lets Alexa+ handle UAE→India remittances safely, plus a web simulator that stands in for Alexa+.

Built for the **Alexa+ track** of [Build, Ship, Shape: Amazon Developer Hackathon](https://amazonappdev2026.devpost.com/) (Devpost), with the AWS Builder and Open Source mini challenges.

## What it does

One remittance provider's own Alexa+ add-on. A customer in Dubai can ask for today's rate, compare payout methods, send money to a saved recipient, track it to the UTR, cancel before payout, check limits, and set a rate alert — by voice.

Three safety properties hold for every money movement:

1. **Read-back before action.** `prepare_transfer` returns the exact sentence to read back; nothing moves until the user agrees.
2. **Single-use, expiring tokens.** `confirm_transfer` and `cancel_transfer` only execute with a 5-minute, single-use token bound to the authenticated caller.
3. **Server-side limits.** KYC-tier, daily, monthly and cash-pickup caps are enforced in core, not by the model.

## Spec

`docs/SPEC.md` is the build contract: decisions, architecture, the 12-tool contract with JSON schemas, core module interfaces, data model and seed, token lifecycle and tests, simulator design, and the phase plan. The architecture, transfer-lifecycle and timeline diagrams live in the source doc and are not in the Markdown export.

## Status

Phase 2 — core and all 12 tools. The full send flow (rate, compare, find recipient, quote, read-back, confirm, track, cancel, limits, alerts) works over `POST /mcp` with server-enforced refusals. Next: Phase 3, deployment to AWS App Runner and the Alexa+ simulator. See the phase plan in `docs/SPEC.md`.

| Tool | Does | Moves money |
| --- | --- | --- |
| `get_rate` | Acme's AED→INR rate, mid-market rate, 7-day trend | |
| `compare_options` | Receive amount by bank deposit, UPI and cash pickup, against a typical bank | |
| `list_beneficiaries` / `resolve_beneficiary` | Saved recipients; find one by name, nickname or relationship | |
| `quote_transfer` | Fee, locked rate, guaranteed receive amount, limit and purpose checks; held 30 min | |
| `prepare_transfer` | The exact read-back sentence and a single-use 5-minute token | |
| `confirm_transfer` | Charges the card and submits, once, with that token | **yes** |
| `track_transfer` / `get_transfer_history` | Status, timeline, UTR, RFI when under review; history with totals | |
| `cancel_transfer` | Preview with a cancel token, then cancel and refund before payout | **yes** |
| `check_limits` | Tier, remaining limits, plain-words explanation of any refusal | |
| `set_rate_alert` | Tell the user when the rate reaches a target | |

## Run

```bash
pnpm install
cp .env.example .env
pnpm db:migrate && pnpm db:seed
pnpm dev
# MCP endpoint: POST http://127.0.0.1:3000/mcp  (Bearer token from .env)
```

`pnpm test`, `pnpm lint`, `pnpm typecheck` and `pnpm build` are what CI runs. `pnpm db:seed` wipes and reloads the demo data, so every run starts identical; the server also loads it on first start if the database is empty. `pnpm build && pnpm start` runs the bundled server from `dist/`.

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

### Try the send flow with MCP Inspector

Run these from outside the repo folder (`npx` refuses to run inside a pnpm project; see `FRICTION_LOG.md`). Each call is a separate connection; tokens are bound to the authenticated caller, not a session.

```bash
I="npx -y @modelcontextprotocol/inspector@latest --cli http://127.0.0.1:3000/mcp --transport http --header 'Authorization: Bearer $MCP_BEARER_TOKEN'"
eval $I --method tools/list
eval $I --method tools/call --tool-name quote_transfer --tool-arg send_amount=2000 --tool-arg beneficiary_id=ben_01
eval $I --method tools/call --tool-name prepare_transfer --tool-arg quote_id=<quote_id>
eval $I --method tools/call --tool-name confirm_transfer --tool-arg confirmation_token=<confirmation_token>
eval $I --method tools/call --tool-name quote_transfer --tool-arg send_amount=3000 --tool-arg beneficiary_id=ben_01   # refused: MONTHLY_LIMIT
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
