# Acme Remit for Alexa+

[![CI](https://github.com/debashish17/acme-remit/actions/workflows/ci.yml/badge.svg)](https://github.com/debashish17/acme-remit/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/debashish17/acme-remit)](LICENSE)

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

`docs/SPEC.md` is the build contract: decisions, architecture, the 13-tool contract with JSON schemas, core module interfaces, data model and seed, token lifecycle and tests, simulator design, and the phase plan. The architecture, transfer-lifecycle and timeline diagrams live in the source doc and are not in the Markdown export.

## Status

Phase 3 (in progress): the web simulator and the AWS App Runner deployment. All 13 tools are done: the full send flow (rate, compare, find recipient, quote, read-back, confirm, track, cancel, limits, alerts) works over `POST /mcp` with server-enforced refusals, and the simulator runs the demo script against them through Bedrock. See the phase plan in `docs/SPEC.md`.

| Tool | Does | Moves money |
| --- | --- | --- |
| `get_rate` | Acme's AED→INR rate, mid-market rate, 7-day trend; any other ECB or dollar-pegged pair for information | |
| `compare_options` | Receive amount by bank deposit, UPI and cash pickup, against a typical bank | |
| `list_beneficiaries` / `resolve_beneficiary` | Saved recipients; find one by name, nickname or relationship | |
| `quote_transfer` | Fee, locked rate, guaranteed receive amount, limit and purpose checks; held 30 min | |
| `prepare_transfer` | The exact read-back sentence and a single-use 5-minute token | |
| `confirm_transfer` | Texts a one-time code to the phone; with that code, charges the card and submits, once | **yes** |
| `track_transfer` / `get_transfer_history` | Status, timeline, UTR, RFI when under review; history with totals | |
| `cancel_transfer` | Preview with a cancel token, then cancel and refund before payout | **yes** |
| `check_limits` | Tier, remaining limits, plain-words explanation of any refusal | |
| `set_rate_alert` | Tell the user when the rate reaches a target | |
| `get_help` | Acme's reviewed answers: documents, steps, recipients, NRE/NRO, LRS, tax, refunds, safety | |

## Run

```bash
pnpm install
cp .env.example .env
pnpm db:migrate && pnpm db:seed
pnpm dev
# MCP endpoint: POST http://127.0.0.1:3000/mcp  (Bearer token from .env)
```

`pnpm test`, `pnpm lint`, `pnpm typecheck` and `pnpm build` are what CI runs. `pnpm db:seed` wipes and reloads the demo data, so every run starts identical; the server also loads it on first start if the database is empty. `pnpm build && pnpm start` runs the bundled server from `dist/`.

### The simulator

Open `http://127.0.0.1:3000/` and enter `SIM_ACCESS_CODE` from your `.env`. Talk with the orb, the mic button or Space (Chrome or Edge): hold while you speak, or tap once and it listens until you pause. Or type. The assistant speaks with Amazon Polly's Indian English neural voice (Kajal) through `POST /sim/speak`; the voice picker can switch to the browser's own voices, and the page falls back to them if Polly is unavailable (`POLLY_VOICE=none` turns Polly off). **Play demo** steps through the scripted beats one at a time. The panel on the right shows each real JSON-RPC exchange with `POST /mcp`; click a row to see the request and response, with tokens cut to their prefix. The page talks only to `/sim/*`, and the server-side relay holds the Bearer secret. `/sim/chat` calls Bedrock, so it needs AWS credentials (for example `AWS_PROFILE=<profile> pnpm dev`).

For recording, `/?dev=1` adds dev controls (advance the ticker, release the held transfer, fire a rate alert, reset the demo data). They need `DEV_CONTROLS_CODE`, and `/dev/*` answers 404 when it is unset. With the dev code entered, chat turns skip the per-IP limit (the daily Bedrock cap still applies). Press H to hide the panels.

### Conversation evals

```bash
node --env-file=.env scripts/eval.mjs --runs 3   # or --only script,spoken,safety, --verbose
```

This plays whole conversations through `/sim/chat` against a running server: real Bedrock, real `/mcp` round trips, a fresh seed for each. There are three: the demo script word for word, the same journey as speech recognition delivers it ("mom", numbers in words, a question and a change mid-confirmation), and consent edge cases. Each turn is checked for the tools called and not called, refusals, word-for-word read-backs and cancel previews, and words that must not be spoken ("screening", "beneficiary", ids, lists, ISO dates). It uses about 65 Bedrock calls per pass of all three. It resets the demo data, so don't run it while someone is using the simulator.

### Run with Docker

```bash
docker build -t acme-remit .
docker run -p 8080:8080 -e MCP_BEARER_TOKEN=<long-random-string> -e SIM_ACCESS_CODE=<code> acme-remit
# MCP endpoint: POST http://127.0.0.1:8080/mcp · health: GET /health
```

The image is multi-stage on `node:22-alpine`, runs as the non-root `node` user, migrates and loads the demo seed into an empty database on start, and reads all configuration from the environment (see `.env.example`). Bedrock calls from `/sim/chat` need AWS credentials in the environment or an instance role.

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

## Deploy to AWS App Runner

Everything is in `infra/acme-remit.yaml` (CloudFormation) and `.github/workflows/deploy.yml` (GitHub OIDC, no stored AWS keys). Region `us-east-1`.

1. **Create the stack** (console: CloudFormation → Create stack → upload `infra/acme-remit.yaml`), name `acme-remit`, `CreateService=false`, optionally `BudgetEmail`. It creates the ECR repo, generated secrets (`acme-remit/mcp-bearer-token`, `/sim-access-code`, `/dev-controls-code`), the App Runner roles and the GitHub deploy role.
2. **Set the repository variable** `AWS_DEPLOY_ROLE_ARN` (GitHub → Settings → Secrets and variables → Actions → Variables) to the stack output `GitHubDeployRoleArn`.
3. **Push the first image**: run the *Deploy* workflow (Actions → Deploy → Run workflow). With no service yet it pushes `<sha>` and `live` to ECR and stops.
4. **Create the service**: update the stack with `CreateService=true`. The output `ServiceUrl` is the public URL; the MCP endpoint is `<ServiceUrl>/mcp`.
5. From then on every push to `main` that passes CI builds, pushes, starts an App Runner deployment, waits for it, and records per-tool p50/p95 latency from the (US-hosted) runner in the job summary, failing if any p95 exceeds 500 ms.

The service runs exactly one instance (min = max = 1) because the SQLite ledger lives on it; each deploy starts from the demo seed. Its role may call only the configured Bedrock model. The simulator access code and dev-controls code are in Secrets Manager.

## Real vs simulated

| Component | Real | Simulated |
| --- | --- | --- |
| MCP server, Streamable HTTP, spec 2025-11-25 | yes | |
| Bearer auth, token lifecycle, limit enforcement | yes | |
| AWS App Runner deployment, Bedrock in the client | yes | |
| Mid-market exchange rates | yes (Frankfurter) | |
| Acme FX margin, fees, payout methods, KYC tier limits | | yes |
| Card funding, ledger, screening, payout partner, UTRs | | yes |
| SMS delivery of the step-up code (shown on a simulated phone) | | yes |

## Security model, and what it doesn't cover

**What the server enforces on every transfer, whoever the client is.** Money moves only through `confirm_transfer` and `cancel_transfer`. A transfer needs a quote (rate and fee locked), a read-back the user hears in full, a single-use token bound to the quote and to the authenticated caller (5 minutes), and then a step-up code. Limits are checked again at confirm. Every refusal is structured, so the model can explain it but cannot argue past it.

**Step-up proves possession of the phone, not secrecy.** The 6-digit code is texted to the registered phone and read out loud. Anyone in the room hears it, so it shows that whoever is approving holds the customer's phone right now, not that the code stayed secret. It is one-time, lasts 5 minutes, is bound to one payment (the text names the amount and the recipient), and three wrong tries void the confirmation. The code never appears in a tool result, so the model cannot approve a payment by itself. A production version should prefer an approval push in the provider's app, where nothing is spoken.

**The same-turn consent guard lives in the simulator, not the server.** The simulator stops a token being spent in the turn that issued it. Real Alexa+ won't run that guard, so there the step-up code is the server-side defence against a model that prepares and confirms in one breath: it cannot invent a code it was never given.

**Cancelling has no step-up, on purpose.** A cancel still needs a read-back preview and its own single-use token, and it can only refund the full amount to the sender's own card, before the transfer reaches the payout partner. It cannot redirect money. If cancels ever had side effects beyond that refund, they should get the same check.

**One demo customer behind one Bearer token.** A real Alexa+ add-on would use account linking (OAuth 2.1 with PKCE) so each customer has their own credentials; the caller binding of tokens is already per credential.

**The public simulator is metered.** It needs an access code (given to judges), has per-IP rate limits, and caps Bedrock calls and Polly characters per day, so a public URL cannot run up an unbounded bill. Dev controls are off unless their own code is set.

**Secrets and logs.** Secrets live in AWS Secrets Manager and nothing secret is in the repo. Logs show token prefixes only; step-up codes are stored as salted hashes and never logged; the protocol panel masks tokens and codes.

**Not covered.** Voice biometrics, device signals, fraud scoring and real sanctions screening are out of scope (screening is modelled as a transfer under review, and no reason is ever given). Someone with many IP addresses could spread requests past the per-IP limit, but the daily caps still bound the cost. The ledger is SQLite on one App Runner instance and resets on every deploy, which suits a demo with simulated money and nothing more.

## License

MIT — see `LICENSE`.
