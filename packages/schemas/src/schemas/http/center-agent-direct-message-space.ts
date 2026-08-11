import { z } from "zod/v4";

const CENTER_AGENT_DIRECT_MESSAGE_SPACE_KIND =
  "center_agent_direct_message_space" as const;
const DIRECT_MESSAGE_SPACE_PURPOSE = "openmeld_dm_space";
const ISO_DATE_TIME_SCHEMA = z.iso.datetime({ offset: true });
const trimmedNonEmptyStringSchema = z.string().trim().min(1);

export const centerAgentDirectMessageSpaceProjectionSchema = z.strictObject({
  centerAgentProfileId: trimmedNonEmptyStringSchema,
  isCenterAgentDirectMessageSpace: z.literal(true),
  kind: z.literal(CENTER_AGENT_DIRECT_MESSAGE_SPACE_KIND),
  memberProfileId: trimmedNonEmptyStringSchema,
  organizationId: trimmedNonEmptyStringSchema,
  spaceId: trimmedNonEmptyStringSchema,
});

export const getCenterAgentDirectMessageSpaceProjectionResponseSchema =
  z.strictObject({
    generatedAt: ISO_DATE_TIME_SCHEMA,
    organizationId: trimmedNonEmptyStringSchema,
    projection: z.union([
      centerAgentDirectMessageSpaceProjectionSchema,
      z.null(),
    ]),
  });

export type CenterAgentDirectMessageSpaceProjection = z.infer<
  typeof centerAgentDirectMessageSpaceProjectionSchema
>;

export type GetCenterAgentDirectMessageSpaceProjectionResponse = z.infer<
  typeof getCenterAgentDirectMessageSpaceProjectionResponseSchema
>;

export function deriveCenterAgentDirectMessageSpaceProjection(input: {
  centerAgentProfileId?: string | null;
  directMessagePairKey?: string | null;
  organizationId: string;
  spaceId: string;
  spacePurpose?: string | null;
}): CenterAgentDirectMessageSpaceProjection | null {
  const centerAgentProfileId = normalizeNonEmptyText(
    input.centerAgentProfileId
  );
  if (
    input.spacePurpose !== DIRECT_MESSAGE_SPACE_PURPOSE ||
    centerAgentProfileId === null
  ) {
    return null;
  }

  const pair = parseDirectMessagePairKey(input.directMessagePairKey);
  if (pair === null || !pair.includes(centerAgentProfileId)) {
    return null;
  }

  const memberProfileId = pair[0] === centerAgentProfileId ? pair[1] : pair[0];
  return {
    centerAgentProfileId,
    isCenterAgentDirectMessageSpace: true,
    kind: CENTER_AGENT_DIRECT_MESSAGE_SPACE_KIND,
    memberProfileId,
    organizationId: input.organizationId,
    spaceId: input.spaceId,
  };
}

export function isCenterAgentDirectMessageSpaceProjection(input: {
  centerAgentProfileId?: string | null;
  directMessagePairKey?: string | null;
  spacePurpose?: string | null;
}): boolean {
  return (
    deriveCenterAgentDirectMessageSpaceProjection({
      ...input,
      organizationId: "projection-check",
      spaceId: "projection-check",
    }) !== null
  );
}

function parseDirectMessagePairKey(value: string | null | undefined) {
  const normalized = normalizeNonEmptyText(value);
  if (normalized === null) {
    return null;
  }
  const parts = normalized.split(":").map((part) => part.trim());
  if (parts.length !== 2 || parts.some((part) => part.length === 0)) {
    return null;
  }
  if (parts[0] === parts[1]) {
    return null;
  }
  return parts as [string, string];
}

function normalizeNonEmptyText(
  value: string | null | undefined
): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
