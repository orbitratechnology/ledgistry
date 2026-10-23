# Ledgistry

AI-assisted treasury operations workspace: know what arrived, know what can be paid, and verify what
happened — against **Airwallex Sandbox**. Built for the Airwallex Agentic Banking hackathon.
Ledgistry is a sandbox prototype and not an Airwallex product. Full spec: [`docs/PRD.md`](docs/PRD.md).

## Status

| Phase | Scope | State |
| --- | --- | --- |
| 1 — Foundation | App shell, theme, Supabase auth + RLS, Airwallex client, live balances, audit trail | ✅ Done |
| 2 — Finance domain | Obligations, expected receipts, transaction sync, reconciliation | Next |
| 3 — Planner + AI | Reserve policy, deterministic plan, Claude Haiku explanations | Planned |
| 4 — Guarded execution | Approval fingerprint, sandbox transfers, verification | Planned |
| 5 — Polish | Accessibility pass, demo data/reset, walkthrough | Planned |

## Stack

Next.js 16.4 (App Router, Cache Components, Partial Prefetching, React Compiler) · React 19.3 ·
TypeScript (strict) · Tailwind CSS 4 · shadcn/ui (base-nova, Base UI) · Supabase (Postgres, Auth, RLS) ·
Zod 4 · Vitest 5 · Playwright · Bun 1.4.4.

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

No Supabase service-role key is used: every query runs as the signed-in operator under RLS.

### Database

Migrations live in `supabase/migrations/` and are applied in order (Supabase MCP `apply_migration`,
or `supabase db push`). After a schema change, regenerate `src/lib/db/database.types.ts`.

Tables (all RLS-scoped to the workspace owner, no `anon` access):

- `workspaces` — one per operator, created on first sign-in (`ensure_workspace()` RPC).
- `sync_runs` — each provider read, with status, safe error summary and correlation id.
- `balance_snapshots` — immutable per-currency balances per sync run, as **bigint minor units**.
- `audit_events` — append-only (no UPDATE/DELETE grants, plus a blocking trigger).

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
| `bun run test` | Vitest unit tests (money, env guard, Airwallex client/auth/balances) |
| `bun run test:e2e` | Playwright against a production build at 360/390/768/1280/1440 px |

E2E tests that sign in need `E2E_OPERATOR_EMAIL` / `E2E_OPERATOR_PASSWORD` (read from `.env.local`);
without them those tests are skipped. They read real Airwallex Sandbox balances (read-only).

## Architecture

```
src/
  app/(auth)/           login, access-denied
  app/(workspace)/      overview, reconciliation, obligations, activity, settings (+ Server Actions)
  components/           layout shell, dashboard, theme, shadcn ui/
  lib/                  env (Zod, sandbox host allowlist), money (exact minor units), supabase clients
  server/               server-only: airwallex/ (auth, client, balances, connection), auth/, audit/, balances/
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
- **Auditability.** Sign-ins, refreshes and failures are written to the append-only audit trail.

Developer tooling (skills, MCP servers): [`docs/DEV_ENVIRONMENT.md`](docs/DEV_ENVIRONMENT.md).

## Limitations (Phase 1)

- Reconciliation, obligations, planning, AI explanations and transfers are not built yet.
- Sandbox only; production money movement is out of scope by design.
