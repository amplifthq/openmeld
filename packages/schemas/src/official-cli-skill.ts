import * as z from "zod/v4";

export const OFFICIAL_CLI_SKILL_CONTRACT =
  "openmeld-skills-contract-2026-09-explicit-space-recipients-v1";
export const OFFICIAL_CLI_SKILL_URL =
  "https://openmeld.ai/skills/openmeld-cli/SKILL.md";
export const OFFICIAL_CLI_SKILL_MAX_BYTES = 1_048_576;
export const OFFICIAL_CLI_SKILL_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAFZjFHrQ/QLsJQpHkAbKBRG57fEazhm7zc0dMa54ilWQ=
-----END PUBLIC KEY-----
`;

const markdownPath = /^(?:SKILL\.md|(?:playbooks|references)\/[a-z0-9-]+\.md)$/;
const version = /^\d+\.\d+\.\d+$/;
export const officialCliSkillPayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    revision: z.number().int().positive(),
    minimumCliVersion: z.string().regex(version),
    contractVersion: z.string().min(1).max(128),
    files: z
      .array(
        z
          .object({
            path: z.string().regex(markdownPath),
            content: z.string().min(1).max(131_072),
          })
          .strict()
      )
      .min(1)
      .max(32),
  })
  .strict()
  .superRefine((value, context) => {
    const paths = value.files.map((file) => file.path);
    if (!paths.includes("SKILL.md") || new Set(paths).size !== paths.length) {
      context.addIssue({
        code: "custom",
        message: "Skill entry is required and paths must be unique",
      });
    }
  });

// Sign the exact UTF-8 payload, not a reserialized object.
export const officialCliSkillReleaseSchema = z
  .object({
    payload: z.string().min(1).max(524_288),
    signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/),
  })
  .strict();
export const officialCliSkillChannelSchema = z
  .object({
    schemaVersion: z.literal(1),
    releases: z.array(officialCliSkillReleaseSchema).min(1).max(16),
  })
  .strict();

export type OfficialCliSkillPayload = z.infer<
  typeof officialCliSkillPayloadSchema
>;
export type OfficialCliSkillRelease = z.infer<
  typeof officialCliSkillReleaseSchema
>;
