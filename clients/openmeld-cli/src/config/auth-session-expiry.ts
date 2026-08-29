export type AuthSessionExpiryEligibility =
  | { status: "no_expiry" }
  | { expiresAtMs: number; status: "valid" }
  | { expiresAtMs: number; status: "expired" }
  | { status: "invalid" };

export function resolveAuthSessionExpiryEligibility(
  expiresAt: string | undefined,
  nowMs = Date.now()
): AuthSessionExpiryEligibility {
  const normalized = String(expiresAt ?? "").trim();
  if (!normalized) {
    return { status: "no_expiry" };
  }

  const expiresAtMs = Date.parse(normalized);
  if (Number.isNaN(expiresAtMs)) {
    return { status: "invalid" };
  }
  return expiresAtMs <= nowMs
    ? { expiresAtMs, status: "expired" }
    : { expiresAtMs, status: "valid" };
}
