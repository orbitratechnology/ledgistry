/** Parses LEDGISTRY_OPERATOR_EMAILS ("a@x.com, b@y.com") into normalised addresses. */
export function parseOperatorAllowlist(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

/** An empty allowlist admits any signed-in user; otherwise the email must be listed. */
export function isOperatorAllowed(email: string | null | undefined, allowlist: string[]): boolean {
  if (allowlist.length === 0) return true;
  return !!email && allowlist.includes(email.toLowerCase());
}
