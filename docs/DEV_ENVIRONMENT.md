# Ledgistry developer environment

Tooling that coding agents (Claude Code) use while building Ledgistry. None of it ships in the app.

## Runtime

- **Bun 1.4.4** — package manager and script runner. `.claude/hooks/session-start.sh` pins it in Claude Code cloud sessions and runs `bun install` once `package.json` exists.
- Node 22 is also present (used by `npx`-launched MCP servers).

## Agent skills (`.claude/skills/`, pinned in `skills-lock.json`)

| Source | Skills |
| --- | --- |
| `vercel/next.js` | `next-cache-components-adoption`, `next-cache-components-optimizer`, `next-dev-loop`, `next-bundle-optimizer` |
| `vercel-labs/agent-skills` | `vercel-react-best-practices`, `vercel-composition-patterns` |
| `shadcn/ui` | `shadcn` |
| `supabase/agent-skills` | `supabase`, `supabase-postgres-best-practices` |
| `airwallex/airwallex-marketplace` | `manage-cashflow`, `beneficiary-creation`, `awx-best-practices` |

Update with `npx skills update -p`.

## MCP servers (`.mcp.json`)

| Server | Purpose | Auth |
| --- | --- | --- |
| `next-devtools` | Version-matched Next.js docs, runtime diagnostics from `next dev` (`/_next/mcp`), browser eval | none |
| `shadcn` | Search/view/add components and blocks from the shadcn registry | none |
| `airwallex-dev` | Airwallex docs search + **sandbox** tools (balances, global accounts, simulated deposits, beneficiaries, transfers, transfer-status simulation) | Reads `AIRWALLEX_CLIENT_ID` / `AIRWALLEX_SECRET` from the environment by reference — never inline keys |
| Supabase | Schema, migrations, SQL, advisors, type generation | Connected as a claude.ai connector (not in `.mcp.json`) |

Notes:

- Project MCP servers need a one-time trust approval the first time `claude` starts in this repo (`enabledMcpjsonServers` in `.claude/settings.json` pre-selects them).
- Airwallex's hosted MCP (`https://mcp.sandbox.airwallex.com/developer`) requires a browser OAuth flow, so the stdio package `@airwallex/developer-mcp` is used instead. It is marked deprecated upstream but is functional; switch to the hosted server when working locally with a browser if preferred:
  `claude mcp add --transport http airwallex-dev https://mcp.sandbox.airwallex.com/developer`
- MCPs are **development tools only**. The app talks to Airwallex exclusively through its own server-side REST client (PRD §11.1, §13).

## Credentials expected in the environment

| Variable | Used for |
| --- | --- |
| `AIRWALLEX_CLIENT_ID` | Airwallex sandbox client ID |
| `AIRWALLEX_SECRET` | Airwallex sandbox API key |
| `CLAUDE_API_KEY` | Anthropic API key (AI SDK) |

The app's `src/lib/env.ts` (Phase 1) will accept these names and the PRD names (`AIRWALLEX_API_KEY`, `ANTHROPIC_API_KEY`).
