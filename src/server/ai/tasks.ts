import "server-only";

import type { LanguageModel } from "ai";

import { appearsIn, checkGrounding } from "@/lib/ai/grounding";
import { currencyExponent, formatMoney, isCurrencyCode, minorToDecimalString, parseAmountInput } from "@/lib/money";
import type { PlanChange } from "@/lib/planner/diff";
import type { PlanResult } from "@/lib/planner/plan";
import { evaluatePair, type MatchableReceipt, type MatchableTransaction, type MatchSignal } from "@/lib/reconciliation/matching";
import {
  MATCH_SUGGESTION_SYSTEM,
  PLAN_EXPLANATION_SYSTEM,
  planFacts,
  RECEIPT_EXTRACTION_SYSTEM,
} from "./prompts";
import {
  matchSuggestionSchema,
  matchSuggestionsModelSchema,
  planExplanationModelSchema,
  planExplanationSchema,
  receiptEvidenceModelSchema,
  type PlanExplanationContent,
  type ReceiptEvidenceSuggestion,
} from "./schemas";
import { aiFailure, generateStructured, type AiResult } from "./service";

type TaskOptions = { model?: LanguageModel };

/** Plain-language explanation of a deterministic plan. Rejected if it states any figure the plan does not. */
export async function explainPlan(
  plan: PlanResult,
  version: number,
  changes: PlanChange[],
  options: TaskOptions = {},
): Promise<AiResult<PlanExplanationContent>> {
  const facts = planFacts(plan, version, changes);
  const result = await generateStructured({
    task: "explain_plan",
    schema: planExplanationModelSchema,
    system: PLAN_EXPLANATION_SYSTEM,
    prompt: `<plan_facts>\n${facts}\n</plan_facts>\n\nExplain this plan.`,
    model: options.model,
  });
  if (!result.ok) return result;

  const parsed = planExplanationSchema.safeParse(result.value);
  if (!parsed.success) return aiFailure("invalid_output");
  const content = parsed.data;
  const grounding = checkGrounding(
    [content.headline, content.summary, ...content.keyFacts, ...content.limitations],
    facts,
  );
  if (!grounding.ok) return aiFailure("ungrounded");
  return { ok: true, value: content, modelId: result.modelId };
}

export type AiMatchSuggestion = {
  expectedReceiptId: string;
  /** Recomputed by the rules engine; the model's own claims are not trusted. */
  signals: MatchSignal[];
  explanation: string;
  confidence: number;
};

/**
 * Second opinion for a deposit the rules could not place. Suggestions must name a listed
 * candidate, their explanation must be grounded in the data shown, and they always need review.
 */
export async function suggestReceiptMatches(
  deposit: MatchableTransaction,
  candidates: (MatchableReceipt & { expectedMinor: bigint })[],
  options: TaskOptions = {},
): Promise<AiResult<{ suggestions: AiMatchSuggestion[]; noMatchReason: string | null }>> {
  const money = (minor: bigint, currency: string, exponent: number) =>
    formatMoney(minor, currency, exponent).replace(/\s/g, " ");
  const data = JSON.stringify(
    {
      deposit: {
        amount: money(deposit.amountMinor, deposit.currency, deposit.exponent),
        notYetApplied: money(deposit.unappliedMinor, deposit.currency, deposit.exponent),
        payer: deposit.counterpartyName,
        reference: deposit.reference,
        statementReference: deposit.statementReference,
        receivedOn: deposit.occurredAt?.slice(0, 10) ?? null,
      },
      candidates: candidates.map((receipt) => ({
        id: receipt.id,
        payer: receipt.payerName,
        reference: receipt.reference,
        expected: money(receipt.expectedMinor, receipt.currency, receipt.exponent),
        outstanding: money(receipt.outstandingMinor, receipt.currency, receipt.exponent),
        expectedDate: receipt.expectedDate,
      })),
    },
    null,
    2,
  );
  const result = await generateStructured({
    task: "suggest_matches",
    schema: matchSuggestionsModelSchema,
    system: MATCH_SUGGESTION_SYSTEM,
    prompt: `<deposit_and_candidates>\n${data}\n</deposit_and_candidates>\n\nWhich candidate, if any, does this deposit pay?`,
    model: options.model,
  });
  if (!result.ok) return result;

  const byId = new Map(candidates.map((receipt) => [receipt.id, receipt]));
  const suggestions: AiMatchSuggestion[] = [];
  for (const raw of result.value.suggestions.slice(0, 2)) {
    const parsed = matchSuggestionSchema.safeParse(raw);
    if (!parsed.success) continue;
    const receipt = byId.get(parsed.data.expectedReceiptId);
    if (!receipt || suggestions.some((item) => item.expectedReceiptId === receipt.id)) continue;
    if (!checkGrounding([parsed.data.explanation], data).ok) continue;
    const evaluated = evaluatePair(deposit, receipt);
    if (!evaluated) continue;
    suggestions.push({
      expectedReceiptId: receipt.id,
      signals: evaluated.signals,
      explanation: parsed.data.explanation,
      confidence: evaluated.score,
    });
  }
  const reason = result.value.noMatchReason?.trim() || null;
  return {
    ok: true,
    value: { suggestions, noMatchReason: reason && checkGrounding([reason], data).ok ? reason.slice(0, 300) : null },
    modelId: result.modelId,
  };
}

function toIsoDate(value: string): string | null {
  const trimmed = value.trim();
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
  const parsed = Date.parse(iso ? `${iso}T00:00:00Z` : `${trimmed} 00:00 UTC`);
  if (Number.isNaN(parsed)) return null;
  const date = new Date(parsed).toISOString().slice(0, 10);
  const year = Number(date.slice(0, 4));
  return year >= 2000 && year <= 2100 ? date : null;
}

/**
 * Pre-fills an expected receipt from pasted text. Every value must appear in the text itself;
 * anything else is dropped with a note. The operator reviews and saves the form.
 */
export async function extractReceiptEvidence(
  text: string,
  options: TaskOptions = {},
): Promise<AiResult<ReceiptEvidenceSuggestion>> {
  const result = await generateStructured({
    task: "extract_receipt",
    schema: receiptEvidenceModelSchema,
    system: RECEIPT_EXTRACTION_SYSTEM,
    prompt: `<pasted_text>\n${text}\n</pasted_text>\n\nExtract the expected payment details.`,
    maxOutputTokens: 1_200,
    model: options.model,
  });
  if (!result.ok) return result;

  const raw = result.value;
  const notes = raw.uncertaintyNotes.map((note) => note.trim()).filter(Boolean).slice(0, 4);
  const keep = (value: string | null, label: string, max: number): string | null => {
    const trimmed = value?.trim();
    if (!trimmed) return null;
    if (!appearsIn(trimmed, text) || trimmed.length > max) {
      notes.push(`Ignored the ${label}: it does not appear in the pasted text.`);
      return null;
    }
    return trimmed;
  };

  const payerName = keep(raw.payerName, "payer", 140);
  const reference = keep(raw.reference, "reference", 140);
  const currencyCandidate = raw.currency?.trim().toUpperCase() ?? null;
  const currency = currencyCandidate && isCurrencyCode(currencyCandidate) ? currencyCandidate : null;
  if (currencyCandidate && !currency) notes.push("Ignored an unrecognised currency.");

  let amount: string | null = null;
  const amountText = keep(raw.amount, "amount", 40);
  if (amountText) {
    const exponent = currency ? currencyExponent(currency) : 2;
    const parsed = parseAmountInput(amountText, exponent);
    if (parsed.ok) amount = minorToDecimalString(parsed.minor, exponent);
    else notes.push(`The amount "${amountText}" could not be read exactly: ${parsed.error}`);
  }

  let expectedDate: string | null = null;
  const dateText = keep(raw.statedDate, "date", 40);
  if (dateText) {
    expectedDate = toIsoDate(dateText);
    if (!expectedDate) notes.push(`Could not read the date "${dateText}".`);
  }

  return {
    ok: true,
    value: { payerName, amount, currency, reference, expectedDate, notes: notes.map((note) => note.slice(0, 200)) },
    modelId: result.modelId,
  };
}
