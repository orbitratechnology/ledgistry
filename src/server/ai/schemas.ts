import "server-only";

import { z } from "zod";

/*
 * Each task has a loose schema sent to the model (structured output) and a strict schema the
 * application applies afterwards. Output that fails the strict schema is discarded, never stored.
 */

export const planExplanationModelSchema = z.object({
  headline: z.string(),
  summary: z.string(),
  keyFacts: z.array(z.string()),
  limitations: z.array(z.string()),
});

export const planExplanationSchema = z.object({
  headline: z.string().trim().min(1).max(160),
  summary: z.string().trim().min(1).max(800),
  keyFacts: z.array(z.string().trim().min(1).max(240)).min(1).max(6),
  limitations: z.array(z.string().trim().min(1).max(240)).max(4),
});

export type PlanExplanationContent = z.infer<typeof planExplanationSchema>;

export const AI_MATCH_SIGNALS = [
  "reference_match",
  "amount_match",
  "partial_amount",
  "currency_match",
  "payer_similarity",
  "date_proximity",
] as const;

export const matchSuggestionsModelSchema = z.object({
  suggestions: z.array(
    z.object({
      expectedReceiptId: z.string(),
      evidenceSignals: z.array(z.enum(AI_MATCH_SIGNALS)),
      explanation: z.string(),
      requiresReview: z.boolean(),
    }),
  ),
  noMatchReason: z.string().nullable(),
});

export const matchSuggestionSchema = z.object({
  expectedReceiptId: z.string().min(1),
  evidenceSignals: z.array(z.enum(AI_MATCH_SIGNALS)),
  explanation: z.string().trim().min(1).max(500),
  requiresReview: z.boolean(),
});

export const receiptEvidenceModelSchema = z.object({
  payerName: z.string().nullable(),
  amount: z.string().nullable(),
  currency: z.string().nullable(),
  reference: z.string().nullable(),
  statedDate: z.string().nullable(),
  uncertaintyNotes: z.array(z.string()),
});

export type ReceiptEvidenceSuggestion = {
  payerName: string | null;
  /** Decimal string validated for the currency, e.g. "4500.00". */
  amount: string | null;
  currency: string | null;
  reference: string | null;
  /** ISO date (YYYY-MM-DD). */
  expectedDate: string | null;
  notes: string[];
};
