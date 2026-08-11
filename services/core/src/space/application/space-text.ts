import { MAX_TEXT_LENGTH } from "@openmeld/protocol";

const SPACE_TEXT_TRUNCATION_SUFFIX = "\n\n[Response truncated by OpenMeld]";

export function truncateSpaceTextToProtocolLimit(text: string): string {
  if (text.length <= MAX_TEXT_LENGTH) {
    return text;
  }

  const availableBodyLength =
    MAX_TEXT_LENGTH - SPACE_TEXT_TRUNCATION_SUFFIX.length;
  if (availableBodyLength <= 0) {
    return SPACE_TEXT_TRUNCATION_SUFFIX.slice(0, MAX_TEXT_LENGTH);
  }

  const truncatedBody = sliceTextAtCharacterBoundary(
    text,
    availableBodyLength
  ).trimEnd();
  return `${truncatedBody}${SPACE_TEXT_TRUNCATION_SUFFIX}`;
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
