const NON_NEGATIVE_INTEGER_RE = /^(0|[1-9][0-9]*)$/;

export function parseNonNegativeIntegerOption(
  raw: string | undefined,
  optionName: string
): number | undefined {
  if (raw === undefined) {
    return undefined;
  }

  const normalized = raw.trim();
  if (!NON_NEGATIVE_INTEGER_RE.test(normalized)) {
    throw new Error(`${optionName} must be a non-negative integer`);
  }

  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(
      `${optionName} must be a non-negative integer no larger than ${Number.MAX_SAFE_INTEGER}`
    );
  }

  return parsed;
}
