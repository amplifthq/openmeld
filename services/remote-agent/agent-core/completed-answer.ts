import { MAX_TEXT_LENGTH } from "@openmeld/schemas";

const REMOTE_AGENT_COMPLETED_TEXT_TRUNCATION_NOTICE =
  "\n\n_Response shortened because it exceeded OpenMeld's 100,000-character response limit._";

export function normalizeRemoteAgentCompletedAnswer(
  text: string | undefined
): string {
  const completedText = text?.trim() ?? "";
  if (!completedText) {
    throw new Error("Remote Agent completed answer cannot be empty.");
  }
  if (completedText.length <= MAX_TEXT_LENGTH) {
    return completedText;
  }
  let sourceEnd =
    MAX_TEXT_LENGTH - REMOTE_AGENT_COMPLETED_TEXT_TRUNCATION_NOTICE.length;
  if (
    sourceEnd > 0 &&
    isHighSurrogate(completedText.charCodeAt(sourceEnd - 1)) &&
    isLowSurrogate(completedText.charCodeAt(sourceEnd))
  ) {
    sourceEnd -= 1;
  }
  return `${completedText.slice(
    0,
    sourceEnd
  )}${REMOTE_AGENT_COMPLETED_TEXT_TRUNCATION_NOTICE}`;
}

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd8_00 && codeUnit <= 0xdb_ff;
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc_00 && codeUnit <= 0xdf_ff;
}
