import * as z from "zod/v4";
import { repositoryFingerprintSchema } from "../http/projects";
import { profileFolderIdSchema } from "./profile-folders";
import { requestChainSchema } from "./request-chain";

const reference = z.string().trim().min(1).max(2048);
// Local workspace owner facts, not client-selected paths or Computer policy.
export const executionContextGitMetadataSchema = z.strictObject({
  commonDirectoryPointerPath: reference,
  configPath: reference,
  gitDirectoryPointerPath: reference,
  hooksPath: reference,
  worktreeConfigPath: reference,
  worktreeGitPointerPath: reference,
});
export const executionContextAccessSchema = z.enum([
  "space_context",
  "read_only",
  "workspace",
]);
const workspace = z.enum(["current", "isolated"]);
// Core's hint for a workspace that was not chosen explicitly: the Service uses
// an isolated copy when the resolved folder is a git repository, otherwise the
// current folder. Core sets it only when the root requester is not the owner.
export const executionContextWorkspaceDefaultSchema =
  z.literal("isolated_if_git");
// Read-only projection of the Core-owned assignment. It contains no native
// conversation, filesystem path, credential, or authority to start work.
export const executionContextDiagnosticsSchema = z.discriminatedUnion(
  "readStatus",
  [
    z.strictObject({
      readStatus: z.literal("found"),
      contextId: z.string().uuid().nullable(),
      access: executionContextAccessSchema,
      permissionSource: z.enum(["agent_settings", "context_restriction"]),
      workspace,
    }),
    z.strictObject({
      readStatus: z.enum(["not_recorded", "authority_unavailable"]),
      reasonCode: z.string().trim().min(1).max(160),
    }),
  ]
);
export const executionContextProjectWorkSchema = z.strictObject({
  projectId: reference,
  repositoryFingerprint: repositoryFingerprintSchema,
  // A complete published object id, never a moving branch or a sender-local path.
  commit: z
    .string()
    .regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u)
    .optional(),
});
// A Service-minted folder id of the target Profile, never a path. Core keeps
// it only when the Profile owner requested the work.
const folderId = profileFolderIdSchema.optional();
const preferences = {
  access: executionContextAccessSchema.optional(),
  folderId,
  projectWork: executionContextProjectWorkSchema.optional(),
  workspace: workspace.optional(),
};
export const executionContextSelectionSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("auto"), ...preferences }),
  z.strictObject({ mode: z.literal("new"), ...preferences }),
  z.strictObject({ mode: z.literal("resume"), sourceWakeId: reference }),
  z.strictObject({
    mode: z.literal("fork"),
    sourceWakeId: reference,
    ...preferences,
  }),
]);

export const executionContextScopeSchema = z.strictObject({
  organizationId: reference,
  requesterProfileId: reference,
  spaceId: reference,
  targetProfileId: reference,
  threadId: reference.nullable(),
});

// Created by Core from an authorized Space message, never supplied by a client.
export const executionContextRequestSchema = z.strictObject({
  required: z.boolean().optional(),
  // Retained for persisted snapshots from older Core versions. Not a permission gate.
  ownerRequested: z.literal(true).optional(),
  // Core-written at Wake time; absent on requests from before the chain.
  requestChain: requestChainSchema.optional(),
  scope: executionContextScopeSchema,
  selection: executionContextSelectionSchema,
  // Core-written when the root requester is not the Profile owner. It applies
  // only to a workspace the selection leaves to the default.
  workspaceDefault: executionContextWorkspaceDefaultSchema.optional(),
});

export const executionContextAssignmentSchema = z
  .strictObject({
    version: z.literal(1),
    id: z.string().uuid(),
    scope: executionContextScopeSchema,
    access: executionContextAccessSchema,
    // Absent: the Profile's default folder, as before folders existed.
    folderId,
    projectWork: executionContextProjectWorkSchema.optional(),
    // Absent on retained tasks: their original folder boundary still applies.
    permissionSource: z.literal("agent_settings").optional(),
    // This Wake's chain, frozen at admission. It is not part of the scope key
    // and is never sent to the OpenMeld Service. Absent: owner-rooted legacy.
    requestChain: requestChainSchema.optional(),
    workspace,
    // Unresolved default: the Service chooses and reports the workspace in
    // the completion; Core then records it and drops this hint. Sent only to
    // a Service with executionContextVersion 7.
    workspaceDefault: executionContextWorkspaceDefaultSchema.optional(),
    forkSource: z
      .strictObject({
        contextId: z.string().uuid(),
        sourceWakeId: reference,
        nativeConversationId: reference,
        // Absent when the boundary is confirmed by read-only preparation instead
        // of by a frozen checkpoint: the source may be a thread OpenMeld never
        // finished a turn on, and only the harness can say where its settled
        // history ends. Core still names the exact source context, Wake, native
        // conversation, and workspace the fork must inherit.
        completedHistoryId: reference.optional(),
        runtimeWorkspaceFingerprint: reference,
        workspace,
        // The source's own folder, so a fork may continue in another one.
        folderId,
      })
      .optional(),
  })
  .refine(
    (context) => !context.permissionSource || context.access === "workspace",
    {
      message: "Task restrictions cannot inherit broader Agent permissions.",
    }
  );

export const executionContextCompletionSchema = z.strictObject({
  contextId: z.string().uuid(),
  nativeConversationId: reference,
  runtimeWorkspaceFingerprint: reference,
  completedHistoryId: reference.optional(),
  // The workspace the Service chose for a task with workspaceDefault.
  workspace: workspace.optional(),
});

export const executionContextLegacyAssociationSchema = z.strictObject({
  id: reference,
  bindingId: reference,
  configurationRevision: z.number().int().positive(),
  agentControllerRef: reference,
  openMeldServiceRuntimeId: reference,
  nativeConversationId: reference.nullable(),
  scope: z.literal("legacy_unclassified"),
});

export const executionContextTaskSchema =
  executionContextAssignmentSchema.safeExtend({
    legacyAssociation: executionContextLegacyAssociationSchema.optional(),
    nativeConversationId: reference.nullable(),
    runtimeWorkspaceFingerprint: reference.nullable(),
  });
