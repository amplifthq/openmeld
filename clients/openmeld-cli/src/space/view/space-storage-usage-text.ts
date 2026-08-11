const TRAILING_DECIMAL_ZERO_REGEX = /\.0$/;

export function formatStorageBytesCompact(bytes: number): string {
  const normalizedBytes = Math.max(0, bytes);
  if (normalizedBytes === 0) {
    return "0 KB";
  }
  if (normalizedBytes < 1000) {
    return `${Math.floor(normalizedBytes)} B`;
  }

  const units = ["KB", "MB", "GB", "TB"] as const;
  let value = normalizedBytes / 1000;
  let unitIndex = 0;
  while (value >= 1000 && unitIndex < units.length - 1) {
    value /= 1000;
    unitIndex += 1;
  }

  const rounded = value >= 10 ? value.toFixed(0) : value.toFixed(1);
  return `${stripTrailingZeroes(rounded)} ${units[unitIndex]}`;
}

export function formatStorageUsagePercentText(percent: number): string {
  return `${Math.round(percent)}% used`;
}

export function formatStorageUsageSummaryText(input: {
  usedBytes: number | null;
  usagePercent: number | null;
}): string | null {
  if (input.usedBytes === null || input.usagePercent === null) {
    return null;
  }

  return `${formatStorageBytesCompact(input.usedBytes)} ( ${formatStorageUsagePercentText(input.usagePercent)} )`;
}

export function formatStorageUsageDetailText(input: {
  usedBytes: number | null;
  softLimitBytes: number | null;
  usagePercent: number | null;
}): string | null {
  const { softLimitBytes, usedBytes, usagePercent } = input;
  const summaryText = formatStorageUsageSummaryText({
    usedBytes,
    usagePercent,
  });
  if (summaryText === null) {
    return null;
  }
  if (usedBytes === null || usagePercent === null) {
    return null;
  }
  if (softLimitBytes === null) {
    return summaryText;
  }

  return `${formatStorageBytesCompact(usedBytes)} / ${formatStorageBytesCompact(softLimitBytes)} ( ${formatStorageUsagePercentText(usagePercent)} )`;
}

function stripTrailingZeroes(value: string): string {
  return value.replace(TRAILING_DECIMAL_ZERO_REGEX, "");
}
