import pc from "picocolors";

const POSITIVE_ACCENT_RGB = {
  b: 80,
  g: 255,
  r: 174,
} as const;

export function renderPositiveAccentText(text: string): string {
  if (!pc.isColorSupported) {
    return text;
  }
  return `\u001B[38;2;${String(POSITIVE_ACCENT_RGB.r)};${String(POSITIVE_ACCENT_RGB.g)};${String(POSITIVE_ACCENT_RGB.b)}m${text}\u001B[39m`;
}
