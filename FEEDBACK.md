# Product feedback

One section per tool, API, SDK or service used, as required by the Devpost submission. Each covers what it was used for, what worked well, what needs work, how onboarding felt, and whether we would build with it again. Specific incidents are dated in [`FRICTION_LOG.md`](FRICTION_LOG.md).

> Draft, written from the friction log during the build. Sections marked ⏳ are completed after we use that tool (the Alexa AI CLI attempt, the App Runner go-live, the Devpost form).

---

## MCP TypeScript SDK (`@modelcontextprotocol/sdk` 1.31, Streamable HTTP)

- **Used for:** the whole server: `POST /mcp` in stateless Streamable HTTP mode (spec 2025-11-25), 13 tools registered with zod input schemas, an output schema on `get_rate`, and tool annotations (`readOnlyHint`, `destructiveHint`) that mark the two money-moving tools.
- **Worked well:** `registerTool` with zod schemas turns into clean JSON Schema in `tools/list`, which Bedrock's Converse API accepted as-is. Stateless mode with JSON responses fitted a single App Runner instance with no session store. Protocol-version negotiation worked first time with MCP Inspector, and output-schema validation caught a shape mismatch in our own code.
- **Needs work:**
  - The documented stateless idiom doesn't compile under `exactOptionalPropertyTypes`: `sessionIdGenerator: undefined` and the transport's optional callbacks fail to type-check, so we omitted the option and cast `transport as Transport`.
  - With an output schema, a structured refusal (a normal, expected answer such as "currency not supported") fails validation unless the result is marked `isError: true`. That makes a refusal look like a failure. It would help to declare alternative output shapes, or to skip validation for results flagged as refusals.
- **Onboarding:** quick with the README examples. Strict-TypeScript projects need the type fixes above.
- **Would use again:** yes.

## Alexa AI CLI and Add-on Agent Skill

⏳ To complete after the Alexa+ attempt (`alexa-ai configure`, `alexa-ai new mcp` against the live URL, `addon.json`, icons, `alexa-ai deploy`), including exactly where region gating stops a developer in India.

- **Used for:**
- **Worked well:**
- **Needs work:**
- **Onboarding:**
- **Would use again:**

## Amazon Bedrock (Converse API, tool use, Nova 2 Lite)

- **Used for:** the simulated Alexa+ client: a Converse tool-use loop that calls our MCP server over real JSON-RPC, plus conversation evals that play whole remittance journeys and check what the model did and said.
- **Worked well:** Converse is one interface for tool use across models, so switching models is a config value. Nova 2 Lite is inexpensive ($0.33 per million input tokens, $2.75 per million output on the `us.` profile) and quick: about 0.7 s per call server-side, judging by CloudWatch. It handled 13 tools and multi-step flows (find recipient, quote, prepare, confirm) reliably after prompt tuning. Amazon models need no access request.
- **Needs work:**
  - The Nova 2 Lite model card gives a bare model id in its us-east-1 sample, but the bare id isn't invocable there; only the `us.` / `global.` inference profiles are.
  - The prompt-caching docs don't say whether Nova 2 Lite supports explicit cache points, and the Converse usage fields and CloudWatch metrics don't show whether implicit caching hit. Every call resends about 3,800 tokens of instructions and tool definitions, which is most of the cost.
  - Out of the box the model paraphrased confirmation read-backs, spoke raw status values ("screening"), and once invented a compliance requirement from a history list. Strict prompt rules and evals fixed all three; a guide for consent-critical, verbatim tool output would help.
- **Onboarding:** smooth once the right model id was known. Local credentials through `aws login` expire often, so a long session needs several sign-ins.
- **Would use again:** yes.

## Amazon Polly (neural voice, speech marks)

- **Used for:** the simulator's voice (Kajal, neural, Indian English), with word speech marks to highlight the read-back as it is spoken.
- **Worked well:** natural Indian English voice; about 1.2 s to synthesise a reply from India; the speech marks lined up exactly with the text.
- **Needs work:** audio and speech marks are two separate requests, both billed per character, so every reply costs twice. Speech marks use UTF-8 byte offsets, which JavaScript has to convert for text with "₹" or emoji. One request that returns both, with character offsets as an option, would halve cost and code.
- **Onboarding:** very easy: one SDK call, no setup.
- **Would use again:** yes.

## AWS App Runner (with CloudFormation and GitHub OIDC)

⏳ Deployment experience to be added after go-live. So far it covers authoring only:

- **Used for:** hosting the MCP server and the simulator from one container image. Infrastructure as code: one CloudFormation template (ECR, generated secrets, App Runner, IAM, a budget alarm) and a GitHub Actions deploy through OIDC, with no stored AWS keys.
- **Worked well (authoring):** `RuntimeEnvironmentSecrets` keeps secrets out of the image and the template. A single-instance configuration (min = max = 1) suits a SQLite demo. cfn-lint and cfn-guard (Well-Architected Security Pillar) ran cleanly.
- **Needs work (authoring):** a service can't be created before its image exists in ECR, so the template needs a two-pass bootstrap (`CreateService=false`, push an image, then `true`).
- **Onboarding:**
- **Would use again:**

## AWS CLI and Agent Toolkit for AWS

- **Used for:** local setup (an IAM user through `aws login`), Bedrock and Polly calls, the AWS Price List API for exact prices, CloudWatch and Cost Explorer for spend.
- **Worked well:** the Price List API gave authoritative per-token and per-character prices for cost estimates; CloudWatch's Bedrock token metrics matched the bill exactly.
- **Needs work:** `aws agent-toolkit list-available-skills` crashes on the Windows console code page (cp1252) when a description contains "→". `aws login` asks an interactive y/n when switching a profile's identity, rejects a piped answer on PowerShell 5.1, and `aws logout` doesn't clear the old identity.
- **Onboarding:** good once the profile was set up; the Windows issues cost about an hour.
- **Would use again:** yes.

## Devpost submission form

⏳ To complete when submitting.

- **Used for:**
- **Worked well:**
- **Needs work:**
- **Onboarding:**
- **Would use again:**

## Other services we depended on

- **Frankfurter (ECB reference rates):** free and reliable, but ECB publishes no AED, so the spec's original fetch could never have worked; we derive AED from USD at the CBUAE peg. The `.app` host now redirects to `.dev/v1`, an extra hop on every call. A clear 400 naming the unsupported currency would beat a bare "not found".
- **pnpm 12 (via corepack on Windows):** a placeholder left in `pnpm-workspace.yaml` silently skipped native builds; `pnpm -s` stopped being accepted; mid-session, the native binary stopped launching (`spawnSync … UNKNOWN`, then "Permission denied") until it was allowed again.

---

## Feature requests

| Request | Why it matters | Urgency |
| --- | --- | --- |
| Step-up authorisation (app push or one-time code) before consequential MCP tools, provided by Alexa+ | Voice alone is weak auth for moving money. We built a server-side code by SMS as a workaround; a platform-level approval (in the Alexa app, nothing spoken) would be stronger and consistent across add-ons | critical |
| Alexa+ add-on testing available outside the US | Developers in India cannot test their add-on on a device or in the web simulator | important |
| Bedrock: cache tool definitions across Converse calls, and report cache hits for Nova 2 | Tool specs and instructions are most of every call's cost in a tool-use loop | important |
| Per-tool latency and error metrics in the developer console | The 500 ms budget is hard to verify without instrumentation | nice-to-have |
| MCP SDK: compile under `exactOptionalPropertyTypes`; let structured refusals pass output schemas | Strict TypeScript is common in production servers; refusals are answers, not errors | nice-to-have |
| Polly: audio and speech marks in one request, with character offsets | Halves the cost of a highlighted voice reply and removes byte-offset conversion | nice-to-have |
