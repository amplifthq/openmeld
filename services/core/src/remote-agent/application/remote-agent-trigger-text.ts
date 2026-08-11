import { REMOTE_AGENT_TRIGGER_TEXT_MAX_CHARS } from "@openmeld/schemas";

export function truncateRemoteAgentTriggerText(text: string): string {
  if (text.length <= REMOTE_AGENT_TRIGGER_TEXT_MAX_CHARS) {
    return text;
  }
  return sliceTextAtCharacterBoundary(
    text,
    REMOTE_AGENT_TRIGGER_TEXT_MAX_CHARS
  );
}

function sliceTextAtCharacterBoundary(
  text: string,
  maxCodeUnits: number
): string {
  if (maxCodeUnits <= 0) {
    return "";
  }

  const segmenter =
    typeof Intl !== "undefined" && "Segmenter" in Intl
      ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
      : null;
  const segments = segmenter
    ? Array.from(segmenter.segment(text), (segment) => segment.segment)
    : Array.from(text);

  let result = "";
  for (const segment of segments) {
    if (result.length + segment.length > maxCodeUnits) {
      break;
    }
    result += segment;
  }
  return result;
}
