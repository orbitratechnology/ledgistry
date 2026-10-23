import "server-only";

import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, NoObjectGeneratedError, Output, type LanguageModel } from "ai";
import type { z } from "zod";

import { getAnthropicConfig } from "@/lib/env";

export type AiFailureKind = "disabled" | "timeout" | "provider_error" | "invalid_output" | "ungrounded";

export type AiResult<T> =
  | { ok: true; value: T; modelId: string }
  | { ok: false; kind: AiFailureKind; message: string };

export const AI_FAILURE_MESSAGE: Record<AiFailureKind, string> = {
  disabled: "AI assistance is not configured.",
  timeout: "Claude did not answer in time.",
  provider_error: "Claude is unavailable right now.",
  invalid_output: "Claude's answer did not match the expected format, so it was discarded.",
  ungrounded: "Claude's answer mentioned figures that are not in the records, so it was discarded.",
};

export const aiFailure = <T>(kind: AiFailureKind, message = AI_FAILURE_MESSAGE[kind]): AiResult<T> => ({
  ok: false,
  kind,
  message,
});

function resolveModel(override?: LanguageModel): { model: LanguageModel; modelId: string } | { error: string } {
  if (override) return { model: override, modelId: "test-model" };
  const config = getAnthropicConfig();
  if (!config.ok) return { error: config.message };
  return { model: createAnthropic({ apiKey: config.apiKey })(config.modelId), modelId: config.modelId };
}

/**
 * One structured call to Claude. Bounded by a timeout and a single retry; prompts and outputs
 * are never logged. Callers must still validate and ground the result before using it.
 */
export async function generateStructured<Schema extends z.ZodType>({
  task,
  schema,
  system,
  prompt,
  timeoutMs = 20_000,
  maxOutputTokens = 2_000,
  model: modelOverride,
}: {
  task: string;
  schema: Schema;
  system: string;
  prompt: string;
  timeoutMs?: number;
  maxOutputTokens?: number;
  /** Test seam: a mock model instead of the configured Anthropic one. */
  model?: LanguageModel;
}): Promise<AiResult<z.infer<Schema>>> {
  const resolved = resolveModel(modelOverride);
  if ("error" in resolved) return aiFailure("disabled", resolved.error);
  const { model, modelId: fallbackModelId } = resolved;

  try {
    const result = await generateText({
      model,
      output: Output.object({ schema }),
      system,
      prompt,
      maxOutputTokens,
      timeout: timeoutMs,
      maxRetries: 1,
      // Narrow, well-specified tasks: low effort keeps latency and cost down.
      providerOptions: { anthropic: { effort: "low" } },
    });
    return { ok: true, value: result.output as z.infer<Schema>, modelId: result.response.modelId || fallbackModelId };
  } catch (error) {
    const kind: AiFailureKind = NoObjectGeneratedError.isInstance(error)
      ? "invalid_output"
      : error instanceof Error && /abort|timeout/i.test(`${error.name} ${error.message}`)
        ? "timeout"
        : "provider_error";
    console.warn(`[ai] ${task} failed: ${kind}`);
    return aiFailure(kind);
  }
}
