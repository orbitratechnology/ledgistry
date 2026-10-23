# Vendored agent skills

Copied from upstream so they survive ephemeral cloud containers. Re-sync by
re-copying the same paths from a newer commit.

| Skill | Upstream | Commit |
|---|---|---|
| `shadcn` (minus `evals/`, `agents/`) | `shadcn-ui/ui` → `skills/shadcn` | `3d98900e9b73` |
| `supabase` | `supabase/agent-skills` → `skills/supabase` | `c9be0e931b79` |
| `supabase-postgres-best-practices` | `supabase/agent-skills` → `skills/supabase-postgres-best-practices` | `c9be0e931b79` |
| `next-cache-components-adoption` | `vercel/next.js` → `skills/` (canary) | `3a6dc245d7e5` |
| `next-cache-components-optimizer` | `vercel/next.js` → `skills/` (canary) | `3a6dc245d7e5` |
| `next-dev-loop` | `vercel/next.js` → `skills/` (canary) | `3a6dc245d7e5` |
| `vercel-react-best-practices` | `vercel-labs/agent-skills` → `skills/react-best-practices` | `063bee94c3f4` |
| `vercel-composition-patterns` | `vercel-labs/agent-skills` → `skills/composition-patterns` | `063bee94c3f4` |
| `web-design-guidelines` | `vercel-labs/agent-skills` → `skills/web-design-guidelines` | `063bee94c3f4` |

No official Airwallex skill was found; Airwallex API knowledge comes from the
Airwallex Developer MCP configured in `/.mcp.json`.
