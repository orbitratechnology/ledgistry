# Ledgistry

AI-assisted treasury operations workspace: know what arrived, know what can be paid, and verify what
happened — against **Airwallex Sandbox**. Built for the Airwallex Agentic Banking hackathon.
Ledgistry is a sandbox prototype and not an Airwallex product. Full spec: [`docs/PRD.md`](docs/PRD.md).

## Status

| Phase | Scope | State |
| --- | --- | --- |
| 1 — Foundation | App shell, theme, Supabase auth + RLS, Airwallex client, live balances, audit trail | ✅ Done |
| 2 — Finance domain | Obligations, expected receipts, transaction sync, reconciliation | ✅ Done |
| 3 — Planner + AI | Reserve policy, deterministic plan, Claude Haiku explanations | ✅ Done |
| 4 — Guarded execution | Approval fingerprint, sandbox transfers, verification | Next |
| 5 — Polish | Accessibility pass, demo data/reset, walkthrough | Planned |

## Stack

Next.js 16.4 (App Router, Cache Components, Partial Prefetching, React Compiler) · React 19.3 ·
TypeScript (strict) · Tailwind CSS 4 · shadcn/ui (base-nova, Base UI) · Supabase (Postgres, Auth, RLS) ·
Zod 4 · Vercel AI SDK 7 with Claude Haiku 5.5 · Vitest 5 · Playwright · Bun 1.4.4.

## Getting started

```bash
bun install
cp .env.example .env.local      # fill in Supabase + Airwallex sandbox values
bun run dev                      # http://localhost:3000
```

Required environment (see `.env.example`):

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or `NEXT_PUBLIC_SUPABASE_ANON_KEY`).
- `AIRWALLEX_CLIENT_ID`, `AIRWALLEX_API_KEY` (or `AIRWALLEX_SECRET`) — **sandbox** credentials.
  `AIRWALLEX_BASE_URL` must be exactly `https://api.sandbox.airwallex.com` while
  `AIRWALLEX_SANDBOX_ONLY=true` (the default).
- Optional: `ANTHROPIC_API_KEY` (or `CLAUDE_API_KEY`) and `ANTHROPIC_MODEL_ID` (default
  `claude-haiku-5-5`). Without them, or with `LEDGISTRY_AI=off`, every feature works except the AI
  explanations and suggestions.

No Supabase service-role key is used: every query runs as the signed-in operator under RLS.

### Database

Migrations live in `supabase/migrations/` and are applied in order (Supabase MCP `apply_migration`,
or `supabase db push`). After a schema change, regenerate `src/lib/db/database.types.ts`.

Tables (all RLS-scoped to the workspace owner, no `anon` access):

- `workspaces` — one per operator, created on first sign-in (`ensure_workspace()` RPC).
- `sync_runs` — each provider read, with status, safe error summary and correlation id.
- `balance_snapshots` — immutable per-currency balances per sync run, as **bigint minor units**.
- `audit_events` — append-only (no UPDATE/DELETE grants, plus a blocking trigger).
- `obligations` — payables with priority, due date and an operator-controlled status. A guard trigger
  limits operators to draft/planned/deferred/cancelled, locks material fields once a payment is in
  flight and bumps `version` on every material change (used by Phase 4 approvals).
- `expected_receipts` — forecast inflows. Never counted as cash; once funds are applied the currency
  is fixed and the expected amount cannot drop below what was received.
- `financial_transactions` — Airwallex deposits as evidence, unique per provider id (re-sync never
  duplicates; amount and currency never change after import). Payer bank details are not stored.
- `reconciliation_matches` — suggested / needs-review / confirmed / rejected / reversed / superseded.
  Inserts must start as suggestions; confirmation goes through `confirm_reconciliation_match()`, which
  locks both rows, requires a settled deposit and caps the applied amount at what is still unapplied
  and outstanding.
- `sandbox_simulations` — every simulated deposit, so it is labelled as a simulation everywhere.
- `reserve_policies` — protected reserve per currency (bigint minor units), switchable on/off.
- `financial_plans` — **immutable** plan snapshots (no UPDATE/DELETE), versioned per currency, tied to
  the balance snapshot and reserve they used. `record_financial_plan()` assigns versions under an
  advisory lock and reuses the latest version when the canonical inputs hash is unchanged.
- `plan_explanations` — cached AI explanation (or cached failure) per plan version.
- Views `expected_receipt_progress` and `transaction_application` derive received / outstanding /
  unapplied amounts from confirmed matches; nothing stores a running total.

### Operator account

Create the operator in Supabase → Authentication → Users → *Add user* (tick *Auto confirm*), then
disable public sign-ups (Authentication → Sign In / Providers). Optionally restrict access further
with `LEDGISTRY_OPERATOR_EMAILS`.

## Scripts

| Command | What it does |
| --- | --- |
| `bun run dev` | Dev server |
| `bun run build` / `bun run start` | Production build / server |
| `bun run lint` | ESLint (Next core-web-vitals + TypeScript) |
| `bun run typecheck` | Route type generation + `tsc --noEmit` |
| `bun run test` | Vitest unit tests (money, input parsing, env guard, Airwallex client/auth/balances/deposits, matching rules, receipt states, form schemas, planner, AI grounding and AI tasks with a mock model) |
| `bun run test:e2e` | Playwright against a production build at 360/390/768/1280/1440 px |

E2E tests that sign in need `E2E_OPERATOR_EMAIL` / `E2E_OPERATOR_PASSWORD` (read from `.env.local`);
without them those tests are skipped. They read real Airwallex Sandbox balances. The reconciliation
spec runs once (desktop project) and creates one **simulated** USD sandbox deposit per run. The
planning spec sets the e2e workspace's USD reserve relative to the real balance and calls Claude
once for a receipt pre-fill.

## Architecture

```
src/
  app/(auth)/           login, access-denied
  app/(workspace)/      overview, reconciliation, obligations, activity, settings (+ Server Actions)
  components/           layout shell, dashboard, theme, shadcn ui/
  lib/                  env (Zod, sandbox host allowlist), money (exact minor units), finance states,
                        reconciliation rules engine, planner (pure), AI grounding, form schemas
  server/               server-only: airwallex/ (auth, client, balances, deposits, global accounts,
                        beneficiaries, simulation), ai/ (schemas, prompts, tasks), auth/, audit/,
                        balances/, obligations/, planner/, reconciliation/
  proxy.ts              session refresh + optimistic route protection
supabase/migrations/    versioned schema
e2e/                    Playwright specs
```

Key guarantees already in place:

- **Secrets stay server-side.** Airwallex keys and access tokens live only in `server/` modules
  (`server-only`); the browser never talks to Airwallex.
- **Token reuse.** One login per ~30 minutes: the token is cached until 60 s before `expires_at`,
  with concurrent refreshes coalesced.
- **Resilience.** Explicit timeouts; GETs retry on 429/5xx/timeouts (honouring `Retry-After`);
  POSTs are never retried automatically (money-moving calls will be resolved by `request_id`).
- **Truthful data.** Balances are Zod-validated, converted to exact minor units, missing fields shown
  as *Unavailable* (never zero), currencies never summed, stale data (>15 min) flagged.
- **Auditability.** Sign-ins, refreshes, syncs, every match decision and every obligation/receipt
  change are written to the append-only audit trail.
- **Suggestions, not decisions.** The rules engine (reference, amount, payer, date) only proposes
  matches with a plain-language explanation; ambiguous, reference-less, oversized, pending or
  possibly-duplicate deposits are flagged *needs review*. Applying money always takes an explicit
  confirmation, and decided pairs are never re-suggested.
- **Partial receipts stay partial.** A short deposit applies only what arrived; the receipt shows
  *Partially received* with the exact shortfall, never *Matched*.

### Cash plan

`spendable now = max(0, actual available − protected reserve)`, per currency, from the latest
Airwallex balance snapshot. Obligations are ranked by (1) your priority, (2) due date / overdue,
(3) whether the full amount fits above the reserve after higher-ranked payments, and (4) whether a
beneficiary is linked (if not, its cash is held and it shows as *Needs payment details*). Ties go to
the smaller amount, then the payee name. Every item carries a machine-derived reason, the projected
cash after it and the headroom over the reserve. Expected receipts appear only in a separate,
labelled forecast. Partial payments are never planned.

Each plan is stored as a new immutable version whenever its inputs change: a balance refresh,
deposit sync, match decision, obligation, receipt or reserve change, or a manual *Recalculate*.
The Overview shows what changed since the previous version and flags a plan whose inputs have
changed since it was calculated.

### AI assistance (Claude Haiku 5.5 via Vercel AI SDK)

AI explains and suggests; it never calculates, decides, approves or moves money.

- **Plan explanation** — generated once per plan version from pre-formatted planner facts. Output is
  schema-validated, and any number or currency that is not in the facts gets it rejected
  (*ungrounded*); the deterministic plan is always shown regardless.
- **Match suggestion** — *Ask AI for a match* on a deposit the rules could not place. Only listed
  receipts can be named, the evidence signals and score are recomputed by the rules engine, and the
  suggestion is stored as *needs review*.
- **Receipt pre-fill** — paste remittance text into a new expected receipt; values that do not
  appear in the text are dropped with a note. Nothing is saved until you submit the form.

Record text (payee names, references, pasted text) is passed as quoted data, never as
instructions. Prompts and outputs are not logged; each call has a timeout and one retry, and
failures are recorded in the activity trail.

### Reconciliation flow

1. Add an **expected receipt** (payer, reference, amount, currency, date).
2. **Sync from Airwallex** imports deposits from the last 90 days, or **Simulate deposit** creates a
   sandbox deposit (labelled *Sandbox simulation*) and syncs it.
3. The rules propose matches; review the evidence and the *apply preview*, then **Confirm**, **Reject**,
   or later **Reverse**. Deposits with no suggestion can be matched manually.

Airwallex Deposits API notes: `GET /api/v1/deposits` needs both `from_created_at` and
`to_created_at` (31-day maximum range), so the sync reads 30-day windows. A new deposit can take a
few seconds to appear in the list, so a simulation waits briefly for it. Simulated deposits arrive in
the Global Account's base currency: the sandbox account has an HKD account and a USD account
(*Ledgistry USD receipts (sandbox)*, created for the demo).

Developer tooling (skills, MCP servers): [`docs/DEV_ENVIRONMENT.md`](docs/DEV_ENVIRONMENT.md).

## Limitations (after Phase 3)

- Approvals and transfers are not built yet (Phase 4); a recommendation is not a payment.
- Payer-side transfer fees are unknown before a transfer is quoted and are counted as zero in the
  plan; Phase 4 rechecks before sending.
- The planner checks that a beneficiary is linked, not that its currency matches the obligation.
- Transaction evidence covers deposits (incoming money); outgoing transfers arrive with Phase 4.
- Sandbox only; production money movement is out of scope by design.
