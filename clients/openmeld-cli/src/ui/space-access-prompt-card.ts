import { buildUnifiedCardFrame } from "./card-frame";

const SPACE_ACCESS_WARNING_TITLE = "⚠️ Check Before You Continue";

export function buildSpaceAccessPromptCardMessage(input: {
  lines: string[];
  question: string;
}): string {
  const frame = buildUnifiedCardFrame({
    title: SPACE_ACCESS_WARNING_TITLE,
    rowTextList: input.lines,
    minContentWidth: 76,
  });
  return [
    frame.top,
    frame.empty,
    ...frame.rows,
    frame.empty,
    frame.bottom,
    input.question,
  ].join("\n");
}
