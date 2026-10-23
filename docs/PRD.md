# Ledgistry — Product Requirements Document

**Version:** 1.0  
**Status:** MVP specification for implementation  
**Product type:** Responsive web application for agentic cash reconciliation and treasury control  
**Primary integration:** Airwallex Sandbox API  
**AI layer:** Vercel AI SDK + Claude Haiku 5.5  
**Last updated:** 23 October 2026

---

## 1. Product summary

**Ledgistry** is an AI-assisted treasury operations workspace that helps a finance operator understand what cash is actually available, reconcile incoming funds against expected receipts, prioritize upcoming obligations, and safely execute an approved payment through Airwallex.

Ledgistry must demonstrate a complete, observable loop:

1. Read current balances and relevant transactions from Airwallex.
2. Compare actual transaction evidence with expected receipts and recorded obligations.
3. Identify exact matches, partial receipts, unmatched activity, possible duplicates, and discrepancies.
4. Recalculate a cash allocation plan under explicit, deterministic rules, including a protected cash reserve.
5. Explain the proposed change in plain language using AI, grounded in returned application data.
6. Ask the operator to approve a specific, reviewable payment action.
7. Submit an approved transfer to Airwallex Sandbox using a stable request ID.
8. Retrieve and verify the transfer outcome, refresh balances, update reconciliation state, and record an audit trail.

Ledgistry is **not** an autonomous money-moving agent. AI can extract, classify, summarize, and explain; it cannot override financial controls, silently approve payments, fabricate balances, or execute transfers without a human approval tied to the exact payment details.

## 2. Problem and opportunity

Small finance teams often keep expected receipts, supplier invoices, bank transactions, and cash reserves in separate places. That forces an operator to manually answer several connected questions:

- What money is available now, rather than merely expected?
- Which expected receipts have arrived, and were they full or partial?
- Which obligations can be paid without compromising the minimum reserve?
- What changed since the previous plan, and why?
- Did the payment actually succeed, or is its status still pending or uncertain?

Ledgistry brings those activities into one compact workflow. Its differentiator is not a generic AI chatbot or dashboard; it is an **evidence-driven decision loop** that changes the plan as financial evidence changes, lets the operator approve a concrete action, performs that action in a sandbox, and verifies the result against Airwallex.

## 3. Product vision and positioning

**Vision:** Make routine cash-control decisions understandable, explainable, and safer to act on.

**Positioning:** An AI-assisted cash reconciliation and payment-control workspace for teams that need to turn transaction evidence into controlled, auditable financial actions.

**Core promise:** “Know what arrived, know what can be paid, and verify what happened.”

### Principles

1. **Evidence before inference.** Live balances and transaction records from Airwallex are authoritative for their respective fields. Expected receipts and obligations are user-provided business records, not actual cash.
2. **Rules before generative output.** Reserve calculations, currency validation, payment eligibility, approval checks, and idempotency are implemented in typed application code.
3. **Human approval before money movement.** No AI response or background operation can approve or execute an unapproved transfer.
4. **Visible uncertainty.** Partial matches, missing data, pending transfers, API failures, and stale balances must be clearly identified.
5. **One coherent workflow.** Prefer a small number of polished screens and connected actions over a wide feature set.
6. **Sandbox-first.** The MVP is built and demonstrated against Airwallex Sandbox. Production money movement is out of scope.
7. **Responsive by default.** The experience must work on desktop, tablet, and mobile with accessible controls and no horizontal page overflow.

## 4. Goals and non-goals

### 4.1 MVP goals

- Connect to an Airwallex Sandbox account securely from server-side code.
- Display current Airwallex balances by currency and distinguish available, pending, reserved, and total amounts when returned by the API.
- Let an operator create and manage expected receipts and payment obligations.
- Ingest or refresh supported Airwallex transaction records and reconcile them against expected receipts.
- Recognize full matches, partial receipts, unmatched transactions, and potential duplicate evidence, with operator review for ambiguous cases.
- Calculate a cash plan that observes a configurable reserve and a transparent priority/deadline order.
- Use Claude Haiku 5.5 through Vercel AI SDK for structured evidence interpretation and grounded explanations.
- Require an explicit operator approval before creating any transfer.
- Create a transfer in Airwallex Sandbox, safely handle uncertain requests, retrieve the transfer status, and refresh the relevant balance/transaction data.
- Maintain an audit timeline showing evidence, decisions, approvals, API actions, and verified results.
- Deliver a focused visual experience inspired by Airwallex’s modern financial-product aesthetic without impersonating Airwallex or using its logo as Ledgistry’s own brand.

### 4.2 Non-goals for the MVP

Do not build these unless a required core flow cannot function without them:

- Gmail or Outlook integration, email inbox access, automated invoice mailbox ingestion.
- Webhooks, event queues, background workers, or a complex scheduled processing system.
- Multiple AI agents, agent-to-agent orchestration, or a general-purpose AI chat workspace.
- Production Airwallex credentials, real-money transfers, or multi-tenant customer onboarding.
- Foreign-exchange optimization, FX execution, yield/cash placement, cards, payroll, tax accounting, or full ERP features.
- Native iOS/Android apps; this is a responsive web app.
- Complex organization roles and permissions beyond a single authenticated workspace owner/operator.
- Custom machine-learning models, vector databases, Redis, Kafka, or microservices.
- Automated execution of multiple payments without a fresh approval for each payment.
- Claims of accounting, audit, banking, regulatory, or investment advice certification.

## 5. Target user and jobs to be done

### Primary user: Finance operator / founder

A small-business founder, finance lead, or operations manager who needs a reliable view of near-term cash and supplier payment readiness without manually comparing separate lists.

**Jobs to be done**

- “When a receipt arrives, show me which expected payment or invoice it relates to.”
- “When only part of an expected receipt arrives, show the shortfall and update the cash plan.”
- “Tell me which obligations I can pay while protecting my minimum cash reserve.”
- “Show why a payment is or is not recommended.”
- “Let me review the exact beneficiary, amount, currency, fee/source amount if applicable, and obligation before I approve.”
- “Prove whether the sandbox transfer completed, failed, or remains pending.”

### Secondary user

A judge, evaluator, or teammate reviewing the demonstration. They should be able to understand the product and verify its financial state changes without needing to read code.

## 6. MVP success criteria

The MVP is considered complete only when all critical acceptance criteria in Section 17 pass.

Product success signals:

- A first-time evaluator can understand the core value within 30 seconds of landing on the dashboard.
- The primary demo can be completed in under five minutes without manually editing the database.
- At least one end-to-end path uses real Airwallex Sandbox API responses rather than static mock transaction results.
- A partial receipt causes a visible reconciliation discrepancy and a newly calculated cash plan.
- A transfer is never sent before explicit confirmation of the displayed payment details.
- The result shown after submission is read back from Airwallex; it is not assumed successful based only on the create-transfer response.
- Key operations are traceable through an audit timeline.
- Core workflows remain usable at 360 px mobile width, tablet width, and desktop width.

## 7. Product scope and navigation

Keep the information architecture compact. Suggested primary navigation:

1. **Overview** — balances, reserve, next obligations, reconciliation alerts, current plan.
2. **Reconciliation** — transaction evidence and expected-receipt matching.
3. **Obligations** — supplier obligations, priority, due dates, and payment readiness.
4. **Activity** — transfers, deposit/transaction details, approvals, and audit events.
5. **Settings** — workspace basics, reserve policy, Airwallex connection status, and demo setup status.

The main overview should be the default route after sign-in. A compact global header should show the Ledgistry wordmark, active workspace, Airwallex connection state, and user menu/sign-out.

### Required routes

- `/login` — minimal Supabase Auth sign-in.
- `/` or `/overview` — dashboard.
- `/reconciliation` — match review and receipt discrepancies.
- `/obligations` — obligation list and obligation details/editor.
- `/activity` — payment operations and audit timeline.
- `/settings` — reserve policy and connection status.

A standalone marketing site is not required. Do not create a large public website for the MVP.

## 8. Core functional requirements

Priority labels: **P0** = essential for MVP/demo; **P1** = include if it supports P0 reliability without threatening the deadline; anything else is deferred.

### 8.1 Authentication and workspace

- **P0:** Protect workspace routes with Supabase Auth.
- **P0:** Start with one workspace owner/operator. Avoid multi-tenant complexity in the MVP, but scope database records by authenticated user/workspace where practical so future expansion is possible.
- **P0:** Sign-out must clear the client session and return to `/login`.
- **P0:** No Airwallex API key, Anthropic API key, or Supabase service-role key may be shipped to the browser.
- **P0:** Provide clear setup errors when database or Airwallex configuration is missing; never silently display fake “connected” state.

### 8.2 Airwallex connection and cash position

- **P0:** Authenticate server-side with Airwallex Client ID and API key.
- **P0:** Cache the returned access token only on the server and reuse it until its `expires_at` indicates it is expiring. Do not authenticate before every individual request.
- **P0:** Fetch current balances from Airwallex and display currencies independently. Do not sum amounts in different currencies into a misleading global total.
- **P0:** Display available, pending, reserved, and total balance values when present in the response. Label any omitted API field as unavailable rather than treating it as zero.
- **P0:** Show when data was last refreshed and provide a manual refresh action.
- **P0:** Clearly distinguish **actual balance** from **expected receipts** and **planned payments**.
- **P0:** Handle expired credentials, forbidden scopes, timeouts, rate limiting, and sandbox service errors with useful operator-facing messages.
- **P1:** Display Global Accounts and relevant Global Account transaction evidence when supported by the configured account permissions.

### 8.3 Obligations

- **P0:** Create, edit, view, and archive a payment obligation.
- **P0:** Required fields: payee/display name, description or invoice reference, amount, currency, due date, priority, status, and notes (notes optional).
- **P0:** Priority levels: Critical, High, Normal, Low.
- **P0:** MVP obligation statuses: Draft, Planned, Approval Required, In Progress, Paid, Deferred, Cancelled, Failed. Show clear state transitions and do not equate “transfer created” with “paid.”
- **P0:** Enforce a positive amount, supported ISO currency code, valid date, and required display name.
- **P0:** Store monetary values in a precise decimal or integer-minor-unit representation. Never use JavaScript floating-point arithmetic for financial comparisons.
- **P0:** Editing an obligation that is attached to a pending approval invalidates that approval if amount, currency, beneficiary, source account, or other material transfer details change.
- **P1:** Search and filters by status, due date, priority, and currency.

### 8.4 Expected receipts

- **P0:** Create, edit, view, and archive an expected receipt.
- **P0:** Required fields: payer/display name, expected amount, currency, expected date, reference, and optional notes.
- **P0:** Track the received amount against the expected amount and calculate the outstanding amount.
- **P0:** Receipt states: Expected, Partially Received, Matched, Overdue, Needs Review, Cancelled.
- **P0:** A partial receipt must not be shown as fully reconciled. Store the applied amount and remaining difference separately.
- **P0:** Never represent expected money as part of Airwallex’s actual cash balance.
- **P1:** Allow a user to mark a matching candidate for manual review and confirm or reject the proposed association.

### 8.5 Transaction ingestion and reconciliation

- **P0:** Pull available transaction records from the supported Airwallex Sandbox endpoints discovered and validated through the official docs/MCP. For the MVP, use direct refresh/manual sync rather than webhooks.
- **P0:** Normalize relevant transaction fields into a stable internal schema: provider transaction ID, provider reference, statement reference when present, date/time, amount, currency, direction, status, counterparty/payer, source account/global account when available, and raw provider identifier.
- **P0:** Deduplicate imported transactions using stable provider IDs and scoped uniqueness constraints.
- **P0:** Candidate matching should consider, in order of reliability: exact provider/statement reference; currency equality; amount equality or partial-amount relationship; payer/counterparty similarity; date proximity.
- **P0:** A match score may rank candidates, but ambiguous matches must require operator review. Similar names or amounts alone must not silently mark a receipt as settled.
- **P0:** Provide match states: Unmatched, Suggested Match, Partially Matched, Matched, Duplicate Suspected, Needs Review.
- **P0:** Display a clear difference/shortfall amount for partial receipts.
- **P0:** Allow operators to confirm or reject a suggested match and record who/when performed the action.
- **P0:** Keep a durable trail of match decisions; do not silently overwrite a previously confirmed decision when the next sync arrives.
- **P0:** Re-running reconciliation against identical input must not double-count the same transaction or receipt amount.
- **P1:** Add a developer-only/demo action to create a clearly labeled simulated deposit in Airwallex Sandbox for use in the controlled demo. This is a sandbox simulator, not a real customer receipt.

### 8.6 Cash policy and allocation plan

- **P0:** Let the operator configure a protected reserve amount per currency. Each currency’s reserve is independent; do not convert currencies using implied or invented rates.
- **P0:** Read the current actual available balance, include eligible expected/confirmed receipt information only as a separate forecast input, and clearly label any forecast assumption.
- **P0:** Calculate spendable cash per currency using deterministic code. Baseline formula:
  - `spendable_now = max(0, actual_available_balance - protected_reserve)`
  - Do not add pending receipts to spendable-now cash.
  - Forecast cash may include an expected receipt only in a separate scenario and only when labeled as forecast.
- **P0:** Rank obligations using transparent rules, in order: operator’s explicit priority, due date/overdue status, whether the full payment plus any known payer-side fees fits above reserve, and whether required payment details are available. State the exact rule ordering in the UI/help text.
- **P0:** Do not make partial payments unless the operator explicitly changes the obligation to allow a partial payment and the supported Airwallex transfer path is verified. Partial payouts are out of scope by default.
- **P0:** Plan output must include Recommended to Pay, Deferred/At Risk, reason, currency, amount, reserve after action, and the cash/obligation inputs used.
- **P0:** The plan must explain why an obligation is deferred, e.g. “Paying this would reduce projected available cash below your USD 4,000 reserve.”
- **P0:** Show plan timestamp and the balance snapshot/version used to calculate the plan.
- **P0:** Recalculate after any material balance refresh, receipt match, obligation edit, reserve edit, or transfer status change.
- **P0:** AI may explain the plan, but it must not calculate or override final financial amounts. Render values supplied by the deterministic planner.

### 8.7 Payment approval and transfer execution

- **P0:** Only obligations with a valid payee/beneficiary path, supported currency, sufficient cash above reserve, and complete required details can enter approval.
- **P0:** The approval review must show payee/beneficiary, obligation or invoice, transfer amount, transfer currency, source currency/account if applicable, known fees/total payer cost if provided, reference, reason, reserve before/after, current balance timestamp, and why this payment is recommended.
- **P0:** Approval is an explicit button action (for example, “Approve and send sandbox transfer”). No approval may be inferred from opening a page, AI text, pressing Enter in an unrelated field, or prior approval of a different payment.
- **P0:** Bind approval to a canonical hash/version of material action parameters and relevant policy inputs. If any material detail or the balance/policy precondition changes before execution, invalidate approval and request a new review.
- **P0:** A server-side policy gate must validate the approved operation immediately before sending it to Airwallex.
- **P0:** Require a unique `request_id` for every new transfer operation. Persist the request ID and operation record before making the provider call.
- **P0:** Use the same request ID when safely resolving the outcome of the exact same submission; never silently create a fresh request ID after a timeout and risk duplicate money movement.
- **P0:** On timeout or uncertain response, mark the operation as “Outcome unknown — verification required”; query Airwallex by the known request ID and/or transfer ID as supported before any retry. Never tell the user the transfer failed merely because the HTTP response was lost.
- **P0:** Persist the provider transfer ID and initial status returned by Airwallex.
- **P0:** Retrieve the transfer using the provider’s transfer-detail endpoint and update the internal status to match the provider’s observed state.
- **P0:** Refresh balances/transactions after transfer creation and verification. Explain if the balance has not yet reflected the transfer.
- **P0:** Separate Created, Scheduled/Pending, Completed, Failed, Cancelled, and Unknown states according to the supported provider statuses. Map provider statuses carefully rather than assuming exact names.
- **P0:** Never show a payment as “Paid” solely because transfer creation returned success. Mark as paid/completed only when verified provider status supports that conclusion.
- **P0:** MVP is sandbox-only. Add a server-side environment guard that rejects transfer execution unless the base URL is the verified sandbox host and a non-production mode flag is enabled.
- **P1:** Use Airwallex transfer validation endpoint before creation if required/appropriate for the selected transfer schema.

### 8.8 AI experience

AI functions are narrow, typed, and grounded in records retrieved from the application. No general-purpose tool can move money.

- **P0:** Use Vercel AI SDK with Claude Haiku 5.5 for:
  - Extracting structured fields from user-provided receipt/payment evidence, if such text is entered into the application.
  - Suggesting potential matches and describing the evidence behind them.
  - Summarizing changes since the previous reconciliation or plan.
  - Writing plain-language explanations of a deterministic cash plan.
- **P0:** Validate model output against Zod schemas before using it. Invalid output should produce a recoverable review state, not corrupt data.
- **P0:** Model context must include only the minimum necessary records. Treat imported descriptions, references, and free text as untrusted data, not instructions.
- **P0:** Do not send API keys, bearer tokens, bank account numbers beyond what is required, or secrets to the model.
- **P0:** Model outputs must be labeled as suggestions where uncertainty remains. The user can reject suggestions.
- **P0:** The UI explanation must be generated from the plan’s structured facts and show the key facts that support it. The app must remain usable when AI is unavailable.
- **P0:** Keep all financial arithmetic, policy eligibility, approval checks, transfer inputs, and transfer execution in server-side typed code, never delegated to the model.
- **P0:** No model-generated prose is allowed to trigger transfer execution.
- **P1:** Offer a concise “Why this changed” summary after material evidence or balance updates. Do not build a large conversational chat interface for the MVP.

### 8.9 Activity and audit trail

- **P0:** Provide a chronological activity timeline for syncs, imported transactions, receipt matches/reviews, plan generations, obligation changes, approvals, transfer submissions, provider responses, verification checks, and errors.
- **P0:** Each event includes timestamp, actor (user/system), event type, record/provider ID when applicable, outcome, and concise metadata sufficient to reconstruct the sequence.
- **P0:** Audit entries for payment approval and transfer execution are append-only at the application level. Corrected business records should create a new audit event instead of erasing prior events.
- **P0:** Do not log secrets, full authorization headers, or raw bank details unnecessarily.
- **P0:** Show links from an obligation to its approval and payment operation, and from a transaction to its reconciliation match.
- **P1:** Include a filter for activity type/status.

## 9. Primary user flows

### Flow A — First-time setup

1. Operator signs in through Supabase Auth.
2. Ledgistry validates server configuration and attempts a server-side Airwallex Sandbox connection.
3. The setup screen shows explicit statuses: Connected, Missing Credentials, Invalid Credentials, Missing API Scope, or Service Unavailable.
4. Operator chooses/creates a reserve policy for each currency they use.
5. Operator refreshes Airwallex balances.
6. If no eligible Global Account or transaction data exists, the app explains that setup is incomplete and gives a sandbox setup checklist instead of inventing data.
7. Operator adds demo obligations and expected receipts (or uses an explicit sample-data action labelled “Load demo data”).

### Flow B — Reconcile an incoming receipt

1. Operator refreshes transactions from Airwallex Sandbox.
2. Ledgistry upserts the new transaction and prevents duplicate imports.
3. Matching code retrieves likely expected receipts using reference, amount, currency, payer, and date.
4. The screen shows the evidence and match rationale, including confidence and any discrepancy.
5. Exact/high-confidence candidates can be suggested, but auto-confirmation is allowed only for deterministic unambiguous rules defined in the implementation; default to operator confirmation for all ambiguous cases.
6. Operator confirms or rejects the match.
7. Receipt received/outstanding amounts update; a partial receipt stays partially matched.
8. The planner recalculates and the dashboard highlights the consequence for cash availability and obligations.

### Flow C — Plan and pay a critical obligation

1. Operator opens Overview and clicks “Recalculate plan.”
2. Ledgistry uses the latest actual balance snapshot, reserve settings, and obligations to produce a deterministic plan.
3. The operator opens a recommended obligation.
4. Ledgistry displays a full review of amount, currency, payee/beneficiary, source currency/account, known costs, reserve effect, and supporting rationale.
5. Operator explicitly approves the exact action.
6. Server rechecks auth, approval fingerprint, balance freshness, reserve, beneficiary details, sandbox environment, and operation uniqueness.
7. Server submits the Airwallex Sandbox transfer with a stable request ID.
8. Ledgistry records the response and requests the provider transfer resource for verification.
9. The activity timeline updates. The UI displays Completed only when provider status confirms completion; otherwise it displays Pending/Unknown/Failed as appropriate.
10. Ledgistry refreshes balance and recomputes the plan.

### Flow D — Partial receipt changes the plan

1. Demo starts with actual available cash of USD 12,000, a USD 4,000 reserve, a critical freight obligation of USD 6,500, and a lower-priority obligation of USD 3,000. Expected receipt is USD 9,000.
2. With no pending receipts included in spendable-now cash, the planner can recommend the USD 6,500 freight payment while preserving the reserve; it defers the USD 3,000 obligation because paying both in sequence would breach the reserve.
3. The operator approves and submits the freight payment using the verified Airwallex Sandbox beneficiary/payment details available in the test account. Actual demo amounts must be validated against sandbox balance and transfer limits before presenting the scenario.
4. After the transfer is verified, Ledgistry refreshes balances.
5. A clearly labelled sandbox simulated deposit of USD 4,500 is created against the expected USD 9,000 receipt (only if an appropriate Global Account exists and the simulation API is available to the sandbox credential).
6. Ledgistry syncs transaction evidence and links the USD 4,500 deposit to the expected USD 9,000 receipt as a partial match, leaving USD 4,500 outstanding.
7. The plan recalculates using actual refreshed available cash and unchanged reserve policy. The lower-priority obligation becomes payable only if the real updated available balance minus the obligation and applicable payer-side costs remains at or above USD 4,000.
8. The overview shows the partial receipt, remaining amount, new allocation, transfer verification state, and a traceable explanation of what changed.

**Important demo integrity rule:** Do not imply that simulated deposits are real customer payments. Label all simulated transactions as sandbox activity. Actual available cash and transfer statuses must come from Airwallex responses; any sample obligations or expected receipts must be labelled as demo/business records.

## 10. User experience and visual design

### 10.1 Design direction

Use a modern financial-operations interface inspired by Airwallex’s polished fintech visual language, but establish Ledgistry’s own identity. Favor a restrained neutral foundation, high contrast, crisp typography, subtle use of a vivid accent, precise financial data hierarchy, tidy cards, and calm micro-interactions. Do not copy Airwallex’s logo, exact branded assets, or imply that Ledgistry is an official Airwallex product.

### 10.2 Theme tokens

Create central CSS variables/design tokens rather than scattering hard-coded values.

- **Base:** white and soft neutral-gray surfaces; ink/near-black primary text.
- **Accent:** choose one brand-inspired vivid accent compatible with Airwallex’s current public visual language; verify against current official brand assets before final polish. Use it sparingly for primary actions, active navigation, and highlights.
- **Semantic status:** accessible, distinct success, warning, danger, and informational treatments; do not rely on color alone.
- **Borders:** subtle neutral borders, consistent radius, almost no decorative gradients.
- **Type:** one modern UI sans-serif stack; strong numeric alignment; use tabular numerals for currency and balance values.
- **Icons:** consistent Lucide icons through shadcn/ui conventions.
- **Spacing:** use a consistent spacing scale and clear section hierarchy.
- **Motion:** short, smooth transitions for dialogs, selection, loading, and state changes. Respect reduced-motion preferences; avoid decorative motion that delays financial tasks.

### 10.3 Dashboard layout

Desktop/tablet should prioritize a persistent or collapsible side navigation and a main content area. Suggested Overview content order:

1. Page title, current date/context, and “Refresh data” action.
2. Connection/data freshness indicator.
3. Currency-specific actual balance and available balance cards, with pending/reserved details where available.
4. Reserve versus spendable-now visualization/summary for the selected currency.
5. Attention items: partial receipts, unmatched transactions, overdue obligations, stale data, transfer requiring verification.
6. Recommended payment plan with priority, amount, reason, and reserve-after-payment.
7. Recent activity/audit events.

Do not combine currencies into one total unless a validated FX conversion is implemented; FX conversion is not part of the MVP.

### 10.4 Responsive requirements

- **Mobile (360–767 px):** single-column layout; side navigation becomes a drawer/menu; balance and obligation cards stack vertically; wide tables become readable transaction cards or controlled horizontal-scroll regions within a bounded component; primary actions remain visible and thumb-reachable.
- **Tablet (768–1023 px):** use adaptive two-column summaries where space permits; navigation can collapse.
- **Desktop (1024 px+):** full workspace layout with sidebar and multi-column cards; avoid excessive whitespace and oversized hero sections.
- At all sizes, no page-level horizontal overflow; all important text wraps safely; dialogs fit within the viewport; keyboard focus is visible; touch targets should be comfortable (aim for 44×44 CSS px for key mobile controls).
- Test at minimum 360×800, 390×844, 768×1024, 1280×800, and 1440×900.

### 10.5 States and feedback

Every screen with networked content needs:

- Initial loading/skeleton state.
- Empty state with a useful next action.
- Partial data state.
- Refreshing state.
- API error/retry state.
- Stale-data warning where financial decisions may be affected.
- Success/failure/pending feedback after writes.
- Confirmation dialog for money movement and any destructive archive/cancel action.

Use precise language. “Transfer submitted” is not “Payment completed.” “Suggested match” is not “Reconciled.” “Expected receipt” is not “Available cash.”

### 10.6 Accessibility

- Follow semantic HTML and accessible shadcn/ui patterns.
- All functionality must work by keyboard.
- Use labels and descriptions on all inputs; associate errors with their input.
- Announce asynchronous state changes through accessible live regions where suitable.
- Maintain readable contrast and do not encode meaning through color alone.
- Honor reduced-motion preferences.

## 11. Technical architecture

### 11.1 Required stack

- **Next.js** — application shell, routing, server components where appropriate, and server-side API routes/actions.
- **TypeScript** — strict typing for domain models, provider schemas, API handlers, and operations.
- **Tailwind CSS** — responsive styling and design tokens.
- **shadcn/ui** — accessible UI primitives and consistent patterns.
- **Supabase** — PostgreSQL database and Supabase Auth; Row Level Security (RLS) for user/workspace-owned rows.
- **Airwallex API** — server-to-server integration for sandbox balances, Global Accounts/transactions when supported, simulated deposits in the demo path, and transfer create/list/detail/verification.
- **Airwallex Docs/Developer MCPs** — developer-time discovery/verification of API docs and schemas. Treat MCPs primarily as development tools; production user actions should pass through controlled application service code and official Airwallex REST APIs unless a specific MCP runtime contract is deliberately validated and documented.
- **Vercel AI SDK** — provider integration and typed structured generation/tooling.
- **Claude Haiku 5.5** — narrow extraction/suggestion/explanation tasks. Configure the exact model identifier through server-side environment settings and verify it against the currently enabled Anthropic API model ID when implementation begins.
- **Zod** — schema validation for inputs, API responses where appropriate, and model-generated structured output.
- **Vitest** — deterministic unit/integration tests.
- **Playwright** — essential end-to-end desktop/mobile viewport checks.
- **Vercel** — deployment/preview environment.
- **GitHub** — source control.

### 11.2 Architecture boundaries

Use a modular monolith; do not split into services for the MVP.

- **UI layer:** views, form state, responsive layout, error/loading states.
- **Application layer:** authorization checks, use cases, approval gate, reconciliation flow, planner orchestration.
- **Domain layer:** typed money, balances, obligations, receipt reconciliation rules, allocation logic, payment-operation state machine, policy checks.
- **Provider layer:** one Airwallex service module for authentication, balances, Global Accounts/transactions, simulated deposits, transfers, and transfer status retrieval.
- **AI layer:** typed prompts and structured outputs for evidence extraction and explanations, isolated from money-moving capabilities.
- **Persistence layer:** Supabase repositories and migrations.

A suggested directory structure:

```text
src/
  app/
    (auth)/login/
    (workspace)/overview/
    (workspace)/reconciliation/
    (workspace)/obligations/
    (workspace)/activity/
    (workspace)/settings/
    api/
      airwallex/
      reconciliation/
      plans/
      payments/
      ai/
  components/
    layout/
    dashboard/
    reconciliation/
    obligations/
    payments/
    activity/
    ui/
  lib/
    auth/
    db/
    env.ts
    money/
    validation/
  server/
    airwallex/
      client.ts
      auth.ts
      balances.ts
      global-accounts.ts
      transactions.ts
      deposits.ts
      transfers.ts
    reconciliation/
    planner/
    payments/
      approval.ts
      execution.ts
      verification.ts
    ai/
      schemas.ts
      prompts.ts
      service.ts
  types/
  test/
supabase/
  migrations/
```

Use server-only modules or equivalent boundaries to prevent provider secrets from entering client bundles. Do not implement the entire integration in client components.

## 12. Data model (Supabase/PostgreSQL)

The final schema may be adapted to real API payloads, but it must preserve the following entities and invariants. Include `id`, timestamps, and owner/workspace scope where applicable. Use foreign keys and database uniqueness constraints for identities and deduplication.

### `workspaces`

- `id` UUID primary key
- `owner_user_id` UUID references Supabase Auth user
- `name` text
- `created_at`, `updated_at`

### `reserve_policies`

- `id` UUID
- `workspace_id` UUID
- `currency` CHAR(3)
- `reserve_amount_minor` BIGINT (or another exact representation appropriate to the currency precision)
- `enabled` boolean
- `updated_by`, `created_at`, `updated_at`
- Unique constraint on `(workspace_id, currency)`

### `balance_snapshots`

- `id` UUID
- `workspace_id` UUID
- `currency` CHAR(3)
- `account_type` text
- `available_amount_minor`, `pending_amount_minor`, `reserved_amount_minor`, `total_amount_minor` (nullable as allowed by provider data)
- `provider` text, `fetched_at` timestamptz
- `raw_reference`/minimal sanitized JSON where useful; never store access tokens or secrets

### `obligations`

- `id` UUID
- `workspace_id` UUID
- `payee_name` text
- `description` text
- `invoice_reference` text nullable
- `amount_minor` BIGINT
- `currency` CHAR(3)
- `due_date` date
- `priority` enum/text constrained to Critical/High/Normal/Low
- `status` enum/text constrained to defined obligation states
- `allow_partial_payment` boolean default false
- `beneficiary_reference`/provider beneficiary ID or validated minimal payment details as applicable; avoid storing unnecessary full bank details
- `notes` text nullable
- `archived_at` timestamptz nullable
- `created_by`, `updated_by`, timestamps

### `expected_receipts`

- `id` UUID
- `workspace_id` UUID
- `payer_name` text
- `expected_amount_minor` BIGINT
- `received_amount_minor` BIGINT default 0
- `currency` CHAR(3)
- `expected_date` date
- `reference` text
- `status` constrained to Expected/Partially Received/Matched/Overdue/Needs Review/Cancelled
- `notes` text nullable
- `created_by`, `updated_by`, timestamps

### `financial_transactions`

- `id` UUID
- `workspace_id` UUID
- `provider` text (Airwallex for MVP)
- `provider_transaction_id` text
- `global_account_id` text nullable
- `provider_reference`, `statement_reference` text nullable
- `direction` text constrained to CREDIT/DEBIT/unknown values mapped safely
- `amount_minor` BIGINT, `currency` CHAR(3)
- `status` text
- `counterparty_name` text nullable
- `occurred_at` timestamptz nullable
- `raw_sanitized` JSONB nullable
- `synced_at` timestamptz
- Unique constraint on `(workspace_id, provider, provider_transaction_id)`

### `reconciliation_matches`

- `id` UUID
- `workspace_id` UUID
- `transaction_id` UUID references `financial_transactions`
- `expected_receipt_id` UUID references `expected_receipts`
- `applied_amount_minor` BIGINT
- `match_type` text: ExactReference, ExactAmount, PartialAmount, Suggested, Manual
- `match_status` text: Suggested, Confirmed, Rejected, Reversed, NeedsReview
- `evidence_summary` text / JSON with non-sensitive reasoning signals
- `confidence` numeric nullable and used only as a suggestion
- `confirmed_by`, `confirmed_at`, timestamps
- Ensure a single transaction cannot be applied above its available amount and a receipt cannot be received above its expected amount without an explicit review/overpayment policy.

### `financial_plans`

- `id` UUID
- `workspace_id` UUID
- `plan_version` integer
- `currency` CHAR(3)
- `balance_snapshot_id` UUID
- `policy_snapshot` JSONB with reserve and rule version
- `plan_inputs_hash` text
- `plan_results` JSONB storing structured ranked outcomes/reasons
- `created_by`, `created_at`
- Plans are immutable snapshots; new inputs create a new plan version.

### `approvals`

- `id` UUID
- `workspace_id` UUID
- `obligation_id` UUID
- `plan_id` UUID
- `operation_fingerprint` text
- `approved_amount_minor` BIGINT
- `currency` CHAR(3)
- `payee/beneficiary fingerprint` text or provider beneficiary ID
- `status` text: Pending/Approved/Consumed/Invalidated/Expired/Rejected
- `approved_by`, `approved_at`, `expires_at`
- `policy_snapshot` JSONB and `balance_snapshot_id`

### `payment_operations`

- `id` UUID
- `workspace_id` UUID
- `obligation_id` UUID
- `approval_id` UUID
- `provider_request_id` text unique within provider/workspace scope
- `provider_transfer_id` text nullable
- `amount_minor` BIGINT, `currency` CHAR(3)
- `status` text: Prepared/Submitted/VerificationRequired/Pending/Completed/Failed/Cancelled/Unknown
- `last_provider_status` text nullable
- `idempotency_fingerprint`/operation hash text
- `request_started_at`, `submitted_at`, `last_verified_at`, timestamps
- `failure_code` text nullable; `safe_error_summary` text nullable

### `audit_events`

- `id` UUID
- `workspace_id` UUID
- `actor_user_id` UUID nullable (null for system events)
- `event_type` text
- `entity_type` text, `entity_id` UUID/text
- `summary` text
- `metadata` JSONB with redacted data only
- `created_at` timestamptz

### Optional internal table: `sync_runs`

Track manual sync start/end, counts, status, last provider cursor if applicable, and safe error details. This supports diagnostics but must not expand into a separate job-processing system.

### Database policy requirements

- Enable RLS on all user/workspace-owned tables.
- Scope reads/writes to the authenticated user’s workspace.
- Use server-only service-role access only when required and validate the current user and workspace before each privileged operation.
- Store secrets in Vercel/server-side environment configuration, never in database rows used as a secret vault.
- Use migrations in version control; no ad hoc production schema changes.

## 13. Airwallex integration requirements

**The official docs and schemas exposed by the configured Airwallex MCPs are the source of truth.** Confirm the actual schema, account permissions, required beneficiary data, and current API version before writing each integration. Do not guess request payloads from examples intended for another transfer route.

### Required operations

1. **Authentication:** `POST /api/v1/authentication/login` using server-side Client ID and API key. Cache token until `expires_at` and refresh when expired/near expiry.
2. **Current balances:** `GET /api/v1/balances/current`.
3. **Global Accounts:** list/retrieve or create only if needed and permitted; prefer using an already configured sandbox Global Account for the demo.
4. **Global Account transactions:** read supported transaction endpoint(s) needed for reconciliation, verifying availability and response fields for the sandbox account.
5. **Sandbox simulated deposit:** `POST /api/v1/simulation/deposit/create` for the demo path only, after validating account and sandbox access. Label simulated funds explicitly in the UI.
6. **Transfer validation:** `POST /api/v1/transfers/validate` if suitable/needed for the verified scenario and transfer schema.
7. **Create transfer:** `POST /api/v1/transfers/create`.
8. **Get transfer details:** `GET /api/v1/transfers/{id}` and/or list/query by `request_id` to verify outcomes where supported.
9. **Refresh state:** re-fetch balances and transactions after meaningful operations.

Use `https://api.sandbox.airwallex.com` for sandbox requests. Do not send sandbox credentials to production hosts or vice versa. Avoid hard-coding endpoints throughout the codebase; define a validated base URL and provider client.

### Integration resilience

- Apply explicit request timeouts and bounded retries only for safe, retryable reads.
- Honor `429` and retry-after/backoff guidance where present.
- Do not blindly retry transfer creation after a timeout. Resolve using the original `request_id` and provider retrieval endpoints first.
- Persist operation intent before calling the provider. Persist response/status as soon as possible after a response.
- Parse and validate provider responses; tolerate extra fields, but fail safely when required fields are missing.
- Return safe, actionable error summaries to the UI while keeping sensitive/raw diagnostics on the server only.
- Log provider request correlation IDs if available, but never log credentials.
- Keep a clear boundary between sandbox simulation endpoints and ordinary production-compatible API calls.

### Required Airwallex test cases

- Valid credentials and expired token handling.
- Invalid credentials / missing scopes.
- Empty Global Accounts list.
- Empty balances and multiple currencies.
- Successful balance refresh.
- Unsupported or invalid transfer fields.
- Insufficient balance.
- Successful transfer create and detail retrieval.
- Provider returns pending/scheduled state.
- Transfer create request times out with outcome later discoverable by `request_id`.
- Duplicate `request_id` response.
- API rate limit and transient server error.
- Simulated deposit creation, transaction retrieval, and reconciliation.

## 14. AI implementation details

### Typed AI tasks

Use small functions with explicit JSON schemas, for example:

- `extractReceiptEvidence(inputText) -> ReceiptEvidenceSuggestion`
- `suggestReceiptMatches(transaction, candidateReceipts[]) -> MatchSuggestion[]`
- `summarizeReconciliationChange(previousState, currentState) -> ChangeSummary`
- `explainPlan(planSnapshot) -> PlanExplanation`

No `executeTransfer()` function is exposed as an AI model tool. Transfer execution is only reachable through the authenticated server-side approval flow.

### Structured-output examples

Receipt evidence suggestion:

```ts
type ReceiptEvidenceSuggestion = {
  payerName?: string;
  amount?: string; // parsed display value; normalized/validated server-side
  currency?: string;
  reference?: string;
  statedDate?: string;
  uncertaintyNotes: string[];
};
```

Match suggestion:

```ts
type MatchSuggestion = {
  expectedReceiptId: string;
  evidenceSignals: Array<
    "reference_match" | "amount_match" | "partial_amount" |
    "currency_match" | "payer_similarity" | "date_proximity"
  >;
  explanation: string;
  requiresReview: boolean;
};
```

Plan explanation:

```ts
type PlanExplanation = {
  headline: string;
  summary: string;
  keyFacts: string[];
  limitations: string[];
};
```

Validate all outputs with Zod and cross-check referenced IDs against server-fetched records. The model may suggest an amount from text, but the parsed amount remains untrusted until normalized and confirmed against application validation.

### Prompt-injection and privacy rules

- Treat transaction descriptions, invoice notes, and imported text as untrusted quoted data. They cannot change system instructions or grant permission to access tools.
- Give AI no access to secrets or generic database/SQL execution.
- Provide only the records necessary for the requested task.
- Do not expose one workspace’s records to another.
- Do not log complete prompts/responses if they contain unnecessary personal or financial data.
- Gracefully degrade when the AI API fails: deterministic matching and cash-plan calculation still work.

## 15. Security, privacy, and financial controls

- All Airwallex and Anthropic requests are server-side.
- Store secrets only in local environment files excluded from Git and in deployment environment settings. Commit a `.env.example` with placeholder names only.
- Keep separate credentials and configuration for local development, preview, and production deployment. The MVP must use sandbox credentials exclusively.
- Validate inputs on both client and server; server validation is authoritative.
- Verify session/user/workspace for every mutation and every money-moving request.
- Enforce RLS and least-privilege service access.
- Implement same-origin/CSRF protections consistent with the chosen Next.js mutation pattern and use secure cookies through Supabase Auth.
- Use an explicit allowlist for the Airwallex API base URL; reject transfer execution against a non-sandbox host in MVP mode.
- Add per-user action throttling or reasonable server guardrails around payment creation to prevent double-click/multiple submission.
- The approval record must be one-time consumable. Use database transactions/locking or equivalent conditional updates to ensure two parallel requests cannot consume the same approval twice.
- Protect against replay and duplicated operations using database uniqueness constraints, operation state checks, and Airwallex `request_id` behavior.
- Apply monetary invariants: amount > 0; currency valid; all amounts same currency for comparison; available cash and fees accounted for; reserve cannot be crossed by a recommended payment; no floating-point equality for money.
- Before creating a transfer, validate that the approval is current, not consumed, not expired, and matches current parameters and policy.
- Use least data retention. Store sanitized provider information and avoid unnecessary personal or banking details.
- Do not claim PCI, SOC 2, GDPR, or other compliance certification. This MVP is a hackathon sandbox prototype.

## 16. Environment configuration

Use an environment schema (for example, Zod) that validates required settings at startup or on the server path where they are used.

Example `.env.example`:

```dotenv
# App
APP_URL=http://localhost:3000
APP_MODE=development

# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Airwallex — Sandbox only for MVP
AIRWALLEX_BASE_URL=https://api.sandbox.airwallex.com
AIRWALLEX_CLIENT_ID=
AIRWALLEX_API_KEY=
AIRWALLEX_SANDBOX_ONLY=true

# Anthropic via Vercel AI SDK
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL_ID=
```

Implementation notes:

- `NEXT_PUBLIC_*` values are public by design and may be in the browser bundle. Only the Supabase URL and anon/publishable key belong there.
- `SUPABASE_SERVICE_ROLE_KEY`, `AIRWALLEX_API_KEY`, `ANTHROPIC_API_KEY`, and any provider token are server-only.
- Set `ANTHROPIC_MODEL_ID` to the exact Claude Haiku 5.5 identifier currently accepted by the Anthropic API at implementation time. Do not assume a friendly display name is necessarily the API identifier.
- Validate the Airwallex host against an exact allowlist for sandbox mode.
- Do not add optional Gmail OAuth, Sentry, third-party data ingestion, webhooks, or other secrets to the initial environment configuration.

## 17. Acceptance criteria and definition of done

### A. Setup and connectivity

- [ ] A new developer can follow README instructions to run the project locally and apply database migrations.
- [ ] Login works and workspace pages are protected.
- [ ] An unconfigured Airwallex account shows a truthful setup/error state; it never pretends to have live data.
- [ ] The server obtains and reuses Airwallex access tokens safely.
- [ ] Balance refresh displays current provider-sourced balance data with a timestamp.

### B. Financial data and reconciliation

- [ ] A user can create an obligation and an expected receipt.
- [ ] Re-syncing a provider transaction does not duplicate it.
- [ ] An exact, unique reference match can be suggested with a clear explanation.
- [ ] A partial deposit updates received and outstanding receipt amounts accurately.
- [ ] An ambiguous match remains reviewable rather than being silently confirmed.
- [ ] Different currencies are never combined without an actual, validated FX conversion.
- [ ] All money arithmetic uses exact integer/decimal operations with tests for currency precision.

### C. Planning

- [ ] Planner excludes pending expected funds from spendable-now cash.
- [ ] Planner respects the reserve and shows reserve after each proposed payment.
- [ ] Planner produces stable results for the same inputs and policy version.
- [ ] A plan becomes a new immutable version after material inputs change.
- [ ] Every recommendation/deferment has a machine-derived reason based on structured facts.

### D. Approval and transfer

- [ ] Transfer approval displays all material details and requires explicit confirmation.
- [ ] No API call to create a transfer can occur without a valid one-time approval.
- [ ] A changed amount, payee, currency, reserve, or other material input invalidates stale approval.
- [ ] A submitted request has a persisted unique request ID and operation record.
- [ ] A timeout does not cause a new transfer to be blindly submitted.
- [ ] Transfer status is retrieved from Airwallex and shown truthfully.
- [ ] “Completed/Paid” is displayed only when verified provider status warrants it.
- [ ] After payment, balance and the cash plan are refreshed/recalculated.
- [ ] Production-host transfer attempts are rejected while MVP sandbox-only mode is enabled.

### E. AI and user experience

- [ ] Model output is schema-validated; malformed output cannot mutate financial state.
- [ ] AI unavailability does not break balance views, reconciliation review, deterministic planning, or payment controls.
- [ ] AI cannot bypass policy, approve its own transfer, or call money-moving APIs directly.
- [ ] Every core screen has useful loading, empty, error, success, and pending states.
- [ ] Core workflows work at 360 px, 390 px, 768 px, 1280 px, and 1440 px widths without page-level horizontal overflow.
- [ ] Keyboard navigation, focus styles, input labels, validation messages, and reduced motion are supported.

### F. Quality and handoff

- [ ] Unit tests cover money arithmetic, partial receipt allocation, reserve calculations, prioritization, stale approvals, and transfer state transitions.
- [ ] Integration tests cover Airwallex provider responses and error scenarios using fixtures or mocks where API calls are not appropriate.
- [ ] End-to-end test covers login (or controlled test session), balance view, receipt match, plan recalculation, transfer approval, sandbox submission, and status verification.
- [ ] README documents setup, migrations, required sandbox configuration, test commands, demo setup, and limitations.
- [ ] `.env.example` contains placeholders only; no real credentials or tokens exist in the repository/history.
- [ ] Demo data and simulated deposits are explicitly labeled as sandbox/demo activity.

## 18. Testing strategy

### Unit tests

Prioritize domain logic before styling:

- Currency-aware money conversion/formatting.
- Invalid precision and negative/zero payment rejection.
- Reserve math and sequence of obligations.
- Obligation rank ordering and tie-breaks.
- Partial receipt calculations and outstanding amount.
- Exact and ambiguous match ranking.
- Duplicate transaction upsert.
- Approval fingerprint invalidation.
- One-time approval consumption under repeated requests.
- Retry/unknown transfer state machine.
- Provider status-to-UI status mapping.

### Integration tests

- Supabase RLS scoping.
- Airwallex token cache/expiry.
- Balance parsing with missing optional fields.
- Simulated deposit -> transaction sync -> partial match.
- Transfer create -> transfer retrieval -> verified status.
- `request_id` timeout recovery.
- Anthropic structured output validation and model outage fallback.

### End-to-end tests

- Desktop core demo path.
- Mobile navigation and key task completion.
- Failed API response shows actionable state and retry path.
- Approval dialog cannot be bypassed by manipulating client state.

Tests must never call production money-moving endpoints. Use sandbox or mocks/fixtures only.

## 19. Seed/demo strategy

Provide an explicit, idempotent demo-data setup action or script. It should create only Ledgistry business records (expected receipts, obligations, reserve policies, optional explanatory notes). It must not fabricate Airwallex balances or provider transfer statuses.

Suggested demo business records, all clearly identified as sample records:

- Currency: USD.
- Protected reserve: USD 4,000.
- Critical freight obligation: USD 6,500.
- Lower-priority supplier obligation: USD 3,000.
- Expected receipt: USD 9,000.

Demo steps:

1. Confirm the sandbox balance/available amount actually supports the test scenario; adjust sample obligations to the real sandbox state if required.
2. Refresh Airwallex balance/transactions.
3. Show the planner recommending the critical payment and deferring the lower-priority one while preserving reserve.
4. Approve and submit the critical sandbox transfer only after reviewing valid supported beneficiary details.
5. Verify provider transfer status and refresh balances.
6. Create a sandbox simulated deposit for a partial USD 4,500 receipt only if the chosen Global Account and sandbox API support it.
7. Sync and match it against the expected USD 9,000 receipt, clearly showing USD 4,500 outstanding.
8. Recalculate and explain which payment is now possible based on refreshed actual balances and the unchanged reserve policy.
9. Open the activity timeline and show the receipt evidence, match, approval, provider transfer, and verification chain.

If the Airwallex sandbox account cannot support the exact figures or beneficiary route, adapt demo amounts or use a test fixture for the planning explanation while keeping every claimed provider balance/transfer state real. Do not fake a successful transfer.

## 20. Delivery milestones

### Phase 1 — Foundation

- Create Next.js TypeScript app, Tailwind, shadcn/ui, and responsive shell.
- Configure Supabase, migrations, Auth, RLS, and typed repositories.
- Establish environment validation, Airwallex sandbox client, and safe logging.
- Verify login, balance API, and current balance rendering against the real sandbox account.

### Phase 2 — Finance domain

- Implement obligations and expected receipts CRUD.
- Implement transaction sync/upsert and deduplication.
- Implement deterministic reconciliation and operator review.
- Add money/currency utilities and unit tests.

### Phase 3 — Planner and AI assistance

- Build the deterministic cash planner and reserve policy.
- Add immutable plan snapshots and reason codes.
- Add Claude Haiku 5.5 structured suggestions and explanation using Vercel AI SDK.
- Verify AI can fail without blocking core financial logic.

### Phase 4 — Guarded execution

- Implement approval fingerprinting and one-time consumption.
- Add sandbox transfer validation/create/retrieve workflows.
- Add timeout recovery, idempotency, balance refresh, and operation-state tracking.
- Add audit events and activity timeline.

### Phase 5 — Polish and submission readiness

- Responsive and accessibility pass.
- Test all required failure paths.
- Confirm all demo data labels and actual-provider status claims.
- Complete README, `.env.example`, tests, setup script, and demo reset procedure.
- Record a concise end-to-end walkthrough only after the sequence is reliable.

## 21. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Airwallex account lacks a suitable Global Account, scope, beneficiary route, or transfer support | Verify prerequisites and actual endpoint schemas early with docs/MCP; keep demo amounts adaptable. |
| A transfer request times out after Airwallex accepted it | Persist request ID first; query provider using the original request ID/transfer ID; never blindly resubmit with a new ID. |
| AI invents a match or misstates a financial fact | Structured outputs, evidence-based fields, operator review, deterministic calculation, and grounding on retrieved records. |
| Duplicate sync double-counts receipts | Stable provider transaction identity, uniqueness constraints, idempotent upsert, and applied-amount invariants. |
| Balance becomes stale between approval and submission | Require a fresh snapshot at approval/execution; recheck before transfer; invalidate when material preconditions change. |
| Scope expands before the core loop works | Defer Gmail, webhooks, FX, multi-user roles, and multi-agent ideas until the end-to-end core loop passes. |
| Sandbox UI differs from actual provider state | Read back transfer status and balances from Airwallex; label simulation; never present fixtures as live provider facts. |
| UI is polished but core finance logic is untested | Build domain tests and provider spike before extensive visual polish. |

## 22. Implementation guardrails for the coding agent

The coding agent must:

1. Read the whole PRD before implementation and turn Section 17 into a task checklist.
2. Inspect official Airwallex docs/MCP schemas before coding a provider request. Do not invent fields or assume a universal transfer payload.
3. Implement the end-to-end vertical slice early: sandbox auth → balance read → receipt/obligation records → deterministic plan → human approval → sandbox transfer → provider verification → audit trail.
4. Keep money logic in pure/testable TypeScript domain functions.
5. Use strict TypeScript and avoid `any` unless justified and isolated.
6. Use Zod at all untrusted boundaries: forms, provider payloads that affect decisions, and AI output.
7. Use accessible shadcn/ui components and test mobile breakpoints while implementing each page.
8. Keep secrets server-only; do not print secrets in logs or include them in screenshots, seeded data, or model prompts.
9. Never implement transfer submission as a direct client-side call to Airwallex.
10. Never let a model-generated answer or client-provided state authorize a payment.
11. Add tests for financial invariants alongside each domain feature, not at the end.
12. Avoid unnecessary abstractions, microservices, queues, and optional integrations.
13. Make every non-provider sample record visibly labeled as demo/sample data.
14. Report incomplete/unsupported Airwallex scenarios honestly in the README rather than simulating success.
15. At completion, provide a short implementation report: completed requirements, tests run, known limitations, required environment variables, and exact steps to run the demo.

## 23. Official integration references

Use these official docs as initial reference points. Confirm the currently active schema/version and sandbox account access through the Airwallex docs/developer MCP before implementation.

- [Airwallex API overview and sandbox guidance](https://www.airwallex.com/docs/developer-tools/api)
- [Airwallex sandbox environment](https://www.airwallex.com/docs/developer-tools/sandbox-environment)
- [Airwallex API access token](https://www.airwallex.com/docs/api/authentication/api_access_token)
- [Airwallex current balances API](https://www.airwallex.com/docs/api/core_resources/balances/current)
- [Airwallex Global Accounts API](https://www.airwallex.com/docs/api/core_resources/global_accounts)
- [Airwallex sandbox simulated deposit API](https://www.airwallex.com/docs/api/simulation/deposits/create)
- [Airwallex Transfers API](https://www.airwallex.com/docs/api/payouts/transfers)
- [Airwallex create a transfer guide](https://www.airwallex.com/docs/payouts/transfers/create-a-transfer)

---

## Final MVP principle

**Do less, but close the loop.** A small responsive product that reconciles a real sandbox transaction, recalculates cash under an explicit reserve, requires human approval, executes one valid sandbox transfer, and verifies the provider result is more valuable than a broad dashboard with disconnected AI features.
