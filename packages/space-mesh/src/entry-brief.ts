import { entryBriefSchema } from "@openmeld/schemas";
import type { EntryBrief } from "@openmeld/schemas/types";
import { OPENMELD_GUIDE_URL } from "./guide-urls";

export function composeEntryBrief(input: unknown): EntryBrief {
  const parsed = entryBriefSchema.safeParse(input);
  if (parsed.success) {
    return parsed.data;
  }
  throw new Error(parsed.error.issues[0]?.message ?? "entry brief is invalid");
}

export function buildSpaceEntryBriefNeedMoreLine(input: {
  cliEntry?: string | null;
  spaceId: string;
  targetProfileId: string;
}): string {
  const cliEntry = normalizeOptionalText(input.cliEntry) ?? "openmeld";
  const spaceId = normalizeOptionalText(input.spaceId) ?? "<space-id>";
  return `run \`${cliEntry} space board ${spaceId} --profile ${input.targetProfileId} --view agent\` for live space state (members, working now, recent outcomes), or read the OpenMeld manual at ${OPENMELD_GUIDE_URL} / run \`${cliEntry} prompt space\`.`;
}

/**
 * Heading for the Space guide in every Agent prompt. Owners write the guide as
 * the room's standing rules, so Agents are told to follow it, below OpenMeld's
 * own rules.
 */
export const SPACE_GUIDE_PROMPT_HEADING =
  "Space guide (standing rules set by this Space's owners; follow them for all work in this Space, with OpenMeld rules and safety boundaries taking precedence)";

export function renderSpaceEntryBrief(input: {
  needMore: string;
  spaceGuide?: string | null;
  thisSpace?: string | null;
  whatThisSpaceIs: string;
  youAre: string;
}): string {
  const spaceGuide = preserveOptionalText(input.spaceGuide);
  const thisSpace = normalizeOptionalText(input.thisSpace);
  return [
    "Space Entry Brief:",
    `- What this space is: ${input.whatThisSpaceIs}`,
    `- You are: ${input.youAre}`,
    thisSpace ? `- This space: ${thisSpace}` : null,
    spaceGuide ? `- ${SPACE_GUIDE_PROMPT_HEADING}:\n${spaceGuide}` : null,
    `- Need more: ${input.needMore}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function preserveOptionalText(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  return value;
}
