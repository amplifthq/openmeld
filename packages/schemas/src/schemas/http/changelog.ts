import * as z from "zod/v4";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";
import { centerAgentToolSpeakerSchema } from "./center-agent-speaker";

export const CHANGELOG_ENTRY_KINDS = [
  "new",
  "improved",
  "fixed",
  "security",
  "breaking",
  "deprecated",
  "removed",
] as const;

export const CHANGELOG_QUERY_DEFAULT_LIMIT = 10;
export const CHANGELOG_QUERY_MAX_LIMIT = 10;
export const CHANGELOG_QUERY_MAX_OFFSET = 10_000;

const changelogSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
const changelogEntryListSchema = z.array(changelogSlugSchema).min(1).max(10);
const changelogFilterListSchema = z.array(changelogSlugSchema).min(1).max(20);
const changelogEvidenceSchema = z.string().trim().min(1).max(240);

export const changelogEntryKindSchema = z.enum(CHANGELOG_ENTRY_KINDS);

export const changelogEntrySchema = z.strictObject({
  areas: changelogEntryListSchema,
  audiences: changelogEntryListSchema,
  body: z.string().trim().min(1).max(4000),
  evidence: z.array(changelogEvidenceSchema).min(1).max(10),
  id: changelogSlugSchema,
  kind: changelogEntryKindSchema,
  publishedAt: z.iso.date(),
  release: z.string().trim().min(1).max(160).optional(),
  title: z.string().trim().min(1).max(240),
});

export const changelogIndexSchema = z.strictObject({
  entries: z.array(changelogEntrySchema).max(10_000),
  schemaVersion: z.literal(1),
});

export const changelogQuerySchema = z.strictObject({
  areas: changelogFilterListSchema.optional(),
  audiences: changelogFilterListSchema.optional(),
  kinds: z
    .array(changelogEntryKindSchema)
    .min(1)
    .max(CHANGELOG_ENTRY_KINDS.length)
    .optional(),
  limit: z.number().int().min(1).max(CHANGELOG_QUERY_MAX_LIMIT).optional(),
  offset: z.number().int().min(0).max(CHANGELOG_QUERY_MAX_OFFSET).optional(),
  release: z.string().trim().min(1).max(160).optional(),
  since: z.iso.date().optional(),
});

export const changelogSourceSchema = z.strictObject({
  kind: z.literal("github"),
  path: z.string().trim().min(1).max(240),
  ref: z.string().trim().min(1).max(160),
  repository: z.string().trim().min(3).max(240),
});

export const changelogQueryResponseSchema = z.strictObject({
  entries: z.array(changelogEntrySchema).max(CHANGELOG_QUERY_MAX_LIMIT),
  hasMore: z.boolean(),
  latestPublishedAt: z.iso.date().nullable(),
  schemaVersion: z.literal(1),
  source: changelogSourceSchema,
  totalMatching: z.number().int().nonnegative(),
});

export const centerAgentReadChangelogToolRpcInputSchema = z.strictObject({
  context: openMeldRequestContextSchema,
  ...changelogQuerySchema.shape,
  speakerMember: centerAgentToolSpeakerSchema,
});
