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
