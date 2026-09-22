import * as z from "zod/v4";

export const CENTER_AGENT_SESSION_TITLE_MAX_LENGTH = 64;
export const CENTER_AGENT_SESSION_TITLE_INPUT_MAX_LENGTH = 6000;
const INVALID_TITLE_PATTERN = /[\r\n]|https?:\/\//i;

export const generateCenterAgentSessionTitleInputSchema = z.strictObject({
  organizationId: z.string().trim().min(1),
  spaceId: z.string().trim().min(1),
  sourceSignalId: z.string().trim().min(1),
  text: z.string().max(CENTER_AGENT_SESSION_TITLE_INPUT_MAX_LENGTH),
  attachmentNames: z.array(z.string().max(255)).max(5),
});

export const generateCenterAgentSessionTitleResponseSchema = z.strictObject({
  title: z
    .string()
    .trim()
    .min(1)
    .max(CENTER_AGENT_SESSION_TITLE_MAX_LENGTH)
    .refine(
      (value) => !INVALID_TITLE_PATTERN.test(value),
      "Use a single-line title without URLs."
    )
    .nullable(),
});

export type GenerateCenterAgentSessionTitleInput = z.infer<
  typeof generateCenterAgentSessionTitleInputSchema
>;
export type GenerateCenterAgentSessionTitleResponse = z.infer<
  typeof generateCenterAgentSessionTitleResponseSchema
>;
