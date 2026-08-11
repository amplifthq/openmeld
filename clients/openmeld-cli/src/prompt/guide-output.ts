import { buildDualViewGuideMessage } from "../runtime/dual-view-guide";
import { formatDualViewGuideForDisplay } from "../runtime/dual-view-guide-display";
import { buildStructuredGuidePayload } from "../runtime/structured-guide-payload";

export function renderPromptGuideText(
  guide: Parameters<typeof buildStructuredGuidePayload>[0]
): string {
  return `${buildDualViewGuideMessage(formatDualViewGuideForDisplay(guide))}\n`;
}

export function buildPromptGuideJson(
  guide: Parameters<typeof buildStructuredGuidePayload>[0]
) {
  return buildStructuredGuidePayload(formatDualViewGuideForDisplay(guide));
}
