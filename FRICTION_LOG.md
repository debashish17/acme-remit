# Friction log

Append-only. One entry per surprise with any tool, SDK, CLI or AWS service used in this project. Submitted with the Devpost entry (up to +10% judging bonus).

Severity: **blocker** (stopped work), **major** (cost more than 30 min or needed a workaround), **minor** (annoying, cosmetic, docs gap).

---

## Template

### YYYY-MM-DD · <tool or service> · <short title>

- **Task:** what I was trying to do
- **Steps:** what I did, in order
- **Expected:** what should have happened
- **Actual:** what happened instead (paste the exact error if any)
- **Severity:** blocker | major | minor
- **Workaround:** what unblocked me, or "none yet"
- **Suggestion:** one concrete change that would have prevented this

---

## Entries


### 2026-10-01 · pnpm 12 · `pnpm-workspace.yaml` left with a placeholder value, native builds skipped silently

- **Task:** Install the pinned dependencies for the project scaffold.
- **Steps:** `pnpm add` the runtime and dev dependencies on a fresh project.
- **Expected:** Either a prompt to approve build scripts, or a clear failure listing which packages need approval.
- **Actual:** pnpm wrote `allowBuilds: esbuild: set this to true or false` into `pnpm-workspace.yaml` and carried on. `better-sqlite3` was not listed at all, and its native binding (`build/Release`) was never compiled, so it would only fail at runtime.
- **Severity:** minor
- **Workaround:** Set `allowBuilds` to `better-sqlite3: true` and `esbuild: true`, then `pnpm rebuild better-sqlite3`; smoke-tested with an in-memory query.
- **Suggestion:** Treat a placeholder `allowBuilds` value as an install error, and list every package whose build script was skipped at the end of `pnpm add`.

### 2026-10-01 · typescript-eslint 8 / TypeScript 7 · `latest` TypeScript is outside typescript-eslint's supported range

- **Task:** Set up lint and typecheck for the scaffold.
- **Steps:** `pnpm add -D typescript typescript-eslint` with no version ranges.
- **Expected:** The latest versions of both work together, or the install warns about the peer range.
- **Actual:** pnpm installed `typescript@7.0.2`, but `typescript-eslint@8.71.0` declares `typescript: ">=4.8.4 <6.1.0"`. No visible warning in the install output.
- **Severity:** minor
- **Workaround:** Pinned `typescript@~6.0.3`. Also pinned `@types/node@^22` to match the Node 22 LTS runtime (latest was 26).
- **Suggestion:** Show peer-range mismatches in the `pnpm add` summary by default.

### 2026-10-02 · npm `npx` / `devEngines` · `npx` refuses to run local binaries in a pnpm project

- **Task:** Type-check a probe file with the project's local `tsc` during Phase 1 setup.
- **Steps:** `npx tsc --noEmit ...` in a repo whose `package.json` has `devEngines.packageManager: { name: "pnpm", onFail: "download" }`.
- **Expected:** `npx` runs `node_modules/.bin/tsc`, maybe with a warning that the project prefers pnpm.
- **Actual:** `npm error code EBADDEVENGINES ... Invalid name "pnpm" does not match "npm" for "packageManager"` and exit 1. `onFail: "download"` does not apply to npx; nothing runs.
- **Severity:** minor
- **Workaround:** Use `pnpm exec <bin>` for every local binary.
- **Suggestion:** npm should not enforce `devEngines.packageManager` for `npx`/`npm exec` of an already-installed local binary, or should honour `onFail` by warning instead of failing.

### 2026-10-02 · pnpm 12 · `pnpm -s <script>` no longer accepted

- **Task:** Run `db:migrate` and `db:seed` quietly while verifying the Phase 1 seed.
- **Steps:** `pnpm -s db:migrate`.
- **Expected:** Runs the script with the script banner suppressed, as in pnpm 8–10 (`-s` = `--silent`).
- **Actual:** `error: unexpected argument '-s' found` and exit 2. `pnpm run --help` lists only `--loglevel silent`.
- **Severity:** minor
- **Workaround:** `pnpm db:migrate` (banner shown), or `pnpm --loglevel silent run <script>`.
- **Suggestion:** Keep `-s` as an alias, or name the replacement in the error message; this breaks copy-pasted scripts and CI snippets from older docs.

### 2026-10-02 · MCP TypeScript SDK 1.31.0 · Stateless Streamable HTTP example does not compile under `exactOptionalPropertyTypes`

- **Task:** Serve `POST /mcp` with `StreamableHTTPServerTransport` in stateless mode (Phase 1).
- **Steps:** Followed the JSDoc/README pattern `new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })` then `server.connect(transport)`, in a TypeScript strict project with `exactOptionalPropertyTypes: true`.
- **Expected:** The documented stateless idiom type-checks; the SDK's own transport is assignable to the SDK's own `Transport` interface.
- **Actual:** `TS2379 ... Types of property 'sessionIdGenerator' are incompatible. Type 'undefined' is not assignable to type '() => string'`, and on `connect`: `Types of property 'onclose' are incompatible. Type '(() => void) | undefined' is not assignable to type '() => void'`.
- **Severity:** minor
- **Workaround:** Omit `sessionIdGenerator` entirely (the runtime only checks for `undefined`), and cast `transport as Transport` at `connect()` with a comment.
- **Suggestion:** Declare optional options and `Transport` callbacks as `prop?: T | undefined` so the SDK compiles under `exactOptionalPropertyTypes`, and add that flag to the SDK's own type tests.
