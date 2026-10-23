# Ledgistry

AI-assisted cash reconciliation and payment-control workspace on Airwallex Sandbox
(Airwallex Agentic Banking hackathon). Spec: `docs/PRD.md`. Delivery plan and
progress: `docs/PLAN.md`.

## Working agreement

- Build phase by phase from `docs/PLAN.md`. Finish one sub-phase, report, and wait
  for the user's approval before starting the next. Never one-shot the app.
- MVP (P0) scope only. Skip anything the PRD marks optional or as a non-goal; a P1
  item is in scope only where the plan says the core demo needs it.
- Develop on the session's designated branch; commit and push after each sub-phase.

## Stack

- Bun (latest) as package manager and script runner: `bun install`, `bun run <script>`,
  `bunx --bun shadcn@latest ...`.
- Next.js 16 App Router, server rendering by default, `cacheComponents: true`,
  `reactCompiler: true`, Turbopack. Use `proxy.ts` (not `middleware.ts`).
- TypeScript strict, Tailwind CSS v4, shadcn/ui components used as shipped
  (dashboard/sidebar blocks, Lucide icons). Theme tokens live in `globals.css`;
  colors match the Airwallex brand palette without using Airwallex logos/assets.
- Supabase Postgres + Auth via `@supabase/ssr`; migrations in `supabase/migrations/`.
- Vercel AI SDK + Anthropic (Claude Haiku) for narrow, Zod-validated tasks only.
- Zod at every untrusted boundary; Vitest for domain tests; Playwright for e2e.
- Responsive: 360, 390, 768, 1280, 1440 px with no page-level horizontal scroll.

## Environment variables

Cloud-session names differ from the PRD; `src/lib/env.ts` maps them:

| PRD name | Session env var |
|---|---|
| `AIRWALLEX_CLIENT_ID` | `AIRWALLEX_CLIENT_ID` |
| `AIRWALLEX_API_KEY` | `AIRWALLEX_SECRET` |
| `ANTHROPIC_API_KEY` | `CLAUDE_API_KEY` |

Never print, log, commit, or send secrets to the browser or the model.

## Non-negotiable financial rules

- Money is integer minor units (`bigint` in TS, `BIGINT` in SQL). No float math.
- Never sum different currencies. Expected receipts are never actual cash.
- All Airwallex calls are server-only, against the sandbox host allowlist only.
- Verify every Airwallex request/response shape with the Airwallex Developer MCP
  before coding it; never guess payloads.
- No transfer without a fresh, one-time, fingerprint-bound human approval. Persist
  `request_id` before calling the provider; on timeout, verify — never resubmit
  with a new ID. "Paid" only after a provider read-back confirms it.
- AI explains and suggests; it never computes final amounts or triggers transfers.
