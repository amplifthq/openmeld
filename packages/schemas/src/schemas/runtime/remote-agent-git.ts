import type * as zod from "zod/v4";
import * as z from "../../lazy-zod";

export const REMOTE_AGENT_GIT_MAX_FILES = 30_000;
export const REMOTE_AGENT_GIT_MAX_BLOB_BYTES = 8 * 1024 * 1024;
export const REMOTE_AGENT_GIT_MAX_TREE_BYTES = 8 * 1024 * 1024;
export const REMOTE_AGENT_GIT_MAX_TOTAL_BYTES = 256 * 1024 * 1024;
export const REMOTE_AGENT_GIT_BATCH_SIZE = 256;
export const REMOTE_AGENT_GIT_TTL_MS = 24 * 60 * 60 * 1000;
export const remoteAgentGitShaSchema = z.string().regex(/^[a-f0-9]{40}$/u);
export const remoteAgentGitKeySchema = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/u);
const segment = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/u);
const path = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (value) =>
      !(value.includes("\\") || value.includes("\u0000")) &&
      value
        .split("/")
        .every(
          (part) =>
            part !== "" &&
            part !== "." &&
            part !== ".." &&
            part.toLowerCase() !== ".git"
        )
  );
export const remoteAgentGitTreeEntrySchema = z.object({
  path,
  mode: z.enum(["100644", "100755", "120000", "160000", "040000"]),
  type: z.enum(["blob", "commit", "tree"]),
  sha: remoteAgentGitShaSchema,
  size: z.number().int().nonnegative().optional(),
});
export const remoteAgentGitTreeSchema = z.object({
  sha: remoteAgentGitShaSchema,
  truncated: z.boolean(),
  tree: z.array(remoteAgentGitTreeEntrySchema).max(REMOTE_AGENT_GIT_MAX_FILES),
});
export const remoteAgentGitCommitSchema = z.object({
  sha: remoteAgentGitShaSchema,
  tree: z.object({ sha: remoteAgentGitShaSchema }),
});
export const remoteAgentGitBlobSchema = z.object({
  sha: remoteAgentGitShaSchema,
  encoding: z.literal("base64"),
  content: z.string().max(Math.ceil(REMOTE_AGENT_GIT_MAX_BLOB_BYTES * 1.5)),
  size: z.number().int().nonnegative().max(REMOTE_AGENT_GIT_MAX_BLOB_BYTES),
});
export const remoteAgentGitRepositorySchema = z.object({
  id: z.number().int().positive(),
  full_name: z.string().min(1),
  default_branch: z.string().min(1),
});
export const remoteAgentGitRefSchema = z.object({
  ref: z.string(),
  object: z.object({ type: z.literal("commit"), sha: remoteAgentGitShaSchema }),
});
export const remoteAgentGitCheckoutInputSchema = z.strictObject({
  key: remoteAgentGitKeySchema,
  owner: segment,
  repo: segment,
  ref: z.string().trim().min(1).max(200),
  githubActor: z.enum(["requester", "organization"]),
});
export const remoteAgentGitPublishInputSchema = z.strictObject({
  key: remoteAgentGitKeySchema,
  localCommit: remoteAgentGitShaSchema,
  expectedRemoteHead: remoteAgentGitShaSchema,
  operationId: remoteAgentGitKeySchema,
  message: z.string().trim().min(1).max(4000),
});
export const remoteAgentGitNativeResultSchema = z.object({
  ready: z.boolean().optional(),
  remaining: z.number().int().nonnegative().optional(),
  missing: z
    .array(remoteAgentGitShaSchema)
    .max(REMOTE_AGENT_GIT_BATCH_SIZE)
    .optional(),
  localCommit: remoteAgentGitShaSchema.optional(),
  baselineLocalCommit: remoteAgentGitShaSchema.optional(),
  tree: remoteAgentGitShaSchema.optional(),
  entries: z
    .array(remoteAgentGitTreeEntrySchema)
    .max(REMOTE_AGENT_GIT_MAX_FILES)
    .optional(),
  blob: z
    .string()
    .max(Math.ceil(REMOTE_AGENT_GIT_MAX_BLOB_BYTES * 1.5))
    .optional(),
});
export const remoteAgentGitNativeRequestSchema = z.strictObject({
  directory: z.string().min(1).max(4096),
  transportDirectory: z.string().min(1).max(4096),
  manifestDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  sourceCommit: remoteAgentGitShaSchema,
  sourceTree: remoteAgentGitShaSchema,
  baselineBranch: z.string().min(1).max(200),
  baselineCommit: remoteAgentGitShaSchema,
  baselineTree: remoteAgentGitShaSchema,
  baselineManifestDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  action: z.enum(["prepare", "snapshot", "blob"]),
  sha: remoteAgentGitShaSchema.optional(),
  output: z.string().min(1).max(4096),
});
export type RemoteAgentGitTreeEntry = zod.infer<
  typeof remoteAgentGitTreeEntrySchema
>;
export type RemoteAgentGitCheckoutInput = zod.infer<
  typeof remoteAgentGitCheckoutInputSchema
>;
export type RemoteAgentGitPublishInput = zod.infer<
  typeof remoteAgentGitPublishInputSchema
>;
export type RemoteAgentGitNativeResult = zod.infer<
  typeof remoteAgentGitNativeResultSchema
>;
