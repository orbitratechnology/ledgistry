/** Text normalisation used by the matching rules. Pure and locale-independent. */

const LEGAL_NOISE = new Set([
  "LTD",
  "LIMITED",
  "LLC",
  "INC",
  "INCORPORATED",
  "CO",
  "COMPANY",
  "CORP",
  "CORPORATION",
  "PTE",
  "PLC",
  "GMBH",
  "SA",
  "BV",
  "AG",
  "PTY",
  "THE",
  "AND",
]);

export function normalizeReference(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function stripDiacritics(value: string): string {
  return value.normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

export function nameTokens(value: string): Set<string> {
  return new Set(
    stripDiacritics(value)
      .toUpperCase()
      .split(/[^A-Z0-9]+/)
      .filter((token) => token.length > 0 && !LEGAL_NOISE.has(token)),
  );
}

/** Jaccard similarity of significant name tokens; 1 when one name's tokens contain the other's. */
export function nameSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  if (!a || !b) return 0;
  const left = nameTokens(a);
  const right = nameTokens(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  if (shared === Math.min(left.size, right.size)) return 1;
  return shared / (left.size + right.size - shared);
}

/**
 * True when `reference` appears in `text` as a whole token sequence: "INV-2041" matches
 * "Payment INV-2041 thanks" and "inv 2041", but not "INV-20410".
 */
export function containsReference(text: string | null | undefined, reference: string): boolean {
  if (!text) return false;
  const needle = normalizeReference(reference);
  if (needle.length < 3) return false;
  if (normalizeReference(text) === needle) return true;

  const tokens = text.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  // Slide over consecutive token runs so separators inside the reference are tolerated.
  for (let start = 0; start < tokens.length; start += 1) {
    let joined = "";
    for (let end = start; end < tokens.length && joined.length < needle.length; end += 1) {
      joined += tokens[end];
      if (joined === needle) return true;
    }
  }
  return false;
}
