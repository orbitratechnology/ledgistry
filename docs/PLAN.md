# Ledgistry delivery plan

Each sub-phase ends with a commit, a short report, and a stop for approval.
Acceptance references point at `docs/PRD.md` §17.

Legend: `[x]` done · `[~]` partly done or blocked · `[ ]` not started

---

## Phase 0 — Environment

- [x] Vendored agent skills in `.claude/skills/`: shadcn, supabase,
      supabase-postgres-best-practices, next-cache-components-adoption,
      next-cache-components-optimizer, next-dev-loop, vercel-react-best-practices,
      vercel-composition-patterns, web-design-guidelines (sources: `SOURCES.md`)
- [x] Project MCP config `.mcp.json`: next-devtools, shadcn, airwallex-developer
- [x] Supabase MCP connected (account connector)
- [x] Bun upgraded to 1.4.4 in this container (checksum-verified)
- [x] `CLAUDE.md` working rules; PRD copied to `docs/PRD.md`
- [~] Network access: npm registry, Airwallex sandbox/docs, Supabase API, shadcn
      registry, Next.js docs, Google Fonts are denied by the environment policy
- [~] Project MCP servers start only after npm is reachable and the session restarts
- [~] Supabase project for Ledgistry: the only existing project (`settlix`) belongs
      to another app

**Done when:** the three project MCP servers connect, the Airwallex Developer MCP
answers a docs query, the sandbox login call returns a token, and a dedicated
Supabase project is reachable.

---

## Phase 1 — Foundation

### 1a. Scaffold
- Next.js 16 (latest stable) + TypeScript strict + Tailwind v4 via Bun, `src/` layout
- `next.config.ts`: `cacheComponents: true`, `reactCompiler: true`, typed routes
- ESLint, Vitest, Playwright config; `bun run` scripts for dev/build/lint/typecheck/test
- SessionStart hook so cloud sessions run `bun install`
- **Done when:** `bun run build`, `lint`, `typecheck`, `test` pass on an empty app

### 1b. Theme and app shell
- `shadcn init`; Airwallex-palette tokens for light and dark in `globals.css`
  (brand colors verified against airwallex.com before committing)
- Dashboard shell from shadcn blocks: collapsible sidebar (mobile drawer),
  header with Ledgistry wordmark, workspace, Airwallex status badge, user menu
- Placeholder pages for `/overview`, `/reconciliation`, `/obligations`,
  `/activity`, `/settings`, each with skeleton/empty states
- **Done when:** the shell renders at 360/390/768/1280/1440 px with no
  horizontal overflow and works with the keyboard alone

### 1c. Database and auth
- Migrations for every PRD §12 table, with constraints, indexes, RLS, and
  workspace scoping; generated TypeScript types
- `@supabase/ssr` clients, `proxy.ts` route protection, `/login`, sign-out,
  automatic workspace creation for the first user
- **Done when:** §17-A login/protection pass and Supabase security advisors are clean

### 1d. Airwallex client and live balances
- `src/lib/env.ts` Zod env validation (sandbox host allowlist, secrets server-only)
- `server/airwallex`: token login + cache until `expires_at`, timeouts, retry
  for safe reads only, 429 handling, typed error mapping
- Balances fetch → `balance_snapshots` → Overview per-currency cards with
  available/pending/reserved/total and missing fields shown as unavailable
- Settings connection status: Connected / Missing / Invalid / Missing scope / Unavailable
- **Done when:** §17-A balance refresh shows real sandbox data with a timestamp

---

## Phase 2 — Finance domain

### 2a. Money module
- `bigint` minor units, ISO 4217 precision table, parse/format, tabular display
- **Done when:** unit tests cover precision, rounding rejection, zero/negative rejection

### 2b. Obligations
- Data table (cards on mobile) with status/priority/currency/due filters
- Create/edit in a Sheet; archive with confirmation; status state machine
- **Done when:** §17-B obligation create passes; edits log audit events

### 2c. Expected receipts
- Same pattern; received/outstanding tracking; receipt status rules
- **Done when:** §17-B receipt create passes

### 2d. Transaction sync
- Global Accounts + transactions (endpoints confirmed via the Airwallex MCP)
- Normalize, upsert with scoped uniqueness, `sync_runs` record, refresh action
- **Done when:** re-syncing never duplicates (§17-B)

### 2e. Reconciliation
- Deterministic candidate scoring (reference → currency → amount/partial →
  payer → date), match states, confirm/reject with actor and time, partial
  receipts with shortfall, idempotent re-runs
- Reconciliation page: evidence, rationale, discrepancy display
- **Done when:** §17-B match, partial, and ambiguity criteria pass with tests

---

## Phase 3 — Planner and AI

### 3a. Reserve policy
- Per-currency reserve settings; edits trigger plan recalculation

### 3b. Deterministic planner
- `spendable_now = max(0, available − reserve)`; ranking by priority → due
  date → fits above reserve → payment details complete; reason codes;
  immutable versioned `financial_plans` with inputs hash
- **Done when:** §17-C passes with unit tests

### 3c. Plan UI
- Overview: reserve vs spendable, attention items, Recommended / Deferred lists
  with reserve-after, plan timestamp and snapshot version, "Recalculate plan"

### 3d. AI assistance
- AI SDK + Claude Haiku: `explainPlan`, `suggestReceiptMatches`,
  `extractReceiptEvidence`, "Why this changed" summary; Zod-validated output,
  ID cross-checks, untrusted-text handling, graceful fallback when AI fails
- **Done when:** §17-E AI criteria pass, including an outage test

---

## Phase 4 — Guarded execution

### 4a. Approval
- Beneficiary path for the sandbox (verified via MCP); review dialog with every
  §8.7 field; fingerprint over material params + policy + snapshot; one-time
  conditional consumption; edits invalidate approvals

### 4b. Transfer execution
- Server policy gate, sandbox-only guard, persisted `request_id` before the call,
  validate → create, timeout → `Unknown — verification required`

### 4c. Verification and refresh
- Transfer detail/request-id lookup, provider status mapping, balance refresh,
  plan recalculation, "Paid" only on verified completion

### 4d. Activity timeline
- Append-only audit events for every step; `/activity` timeline with links
  between obligation, approval, operation, transaction, and match

### 4e. Sandbox deposit simulator (P1, needed by demo Flow D)
- Clearly labelled "Sandbox simulated deposit" action against a Global Account
- **Done when:** §17-D passes end to end against the sandbox

---

## Phase 5 — Polish and submission

- Responsive and accessibility pass at all five viewports; reduced motion
- Failure-path tests (§13 test cases), Playwright desktop and mobile demo path
- "Load demo data" (labelled sample records only), demo reset procedure
- README, `.env.example`, Vercel deployment
- **Done when:** every §17 checkbox passes
