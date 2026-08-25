import * as z from "zod/v4";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";
import {
  listSpaceFilesResponseSchema,
  spaceFileBaseRevisionSchema,
  spaceFileClientMutationIdSchema,
  spaceFileDescriptorSchema,
  spaceFileEntryIdSchema,
  spaceFileEntrySchema,
  spaceFileMimeTypeSchema,
  spaceFileNameSchema,
  spaceFileRevisionNumberSchema,
  spaceFileRevisionSchema,
  spaceFolderDescriptorSchema,
} from "./space-files";

const centerAgentSpaceFileScopeSchema = z.strictObject({
  context: openMeldRequestContextSchema,
  spaceId: z.string().trim().min(1).max(512),
});

export const centerAgentListSpaceFilesRpcInputSchema =
  centerAgentSpaceFileScopeSchema.extend({
    parentId: spaceFileEntryIdSchema.nullable().optional(),
    view: z.enum(["active", "trash"]).optional(),
  });

export const centerAgentListSpaceFilesResponseSchema =
  listSpaceFilesResponseSchema;

export const centerAgentReadSpaceFileRpcInputSchema =
  centerAgentSpaceFileScopeSchema.extend({
    fileId: spaceFileEntryIdSchema,
    includeHistory: z.boolean().optional(),
    revision: spaceFileRevisionNumberSchema.optional(),
  });

export const centerAgentReadSpaceFileResponseSchema = z.strictObject({
  content: z.string(),
  file: spaceFileDescriptorSchema,
  revision: spaceFileRevisionSchema,
  revisions: z.array(spaceFileRevisionSchema).optional(),
});

const centerAgentCreateSpaceFileRpcInputSchema =
  centerAgentSpaceFileScopeSchema.extend({
    action: z.literal("create"),
    clientMutationId: spaceFileClientMutationIdSchema,
    content: z.string(),
    mimeType: spaceFileMimeTypeSchema,
    name: spaceFileNameSchema,
    parentId: spaceFileEntryIdSchema.nullable().optional(),
  });

const centerAgentUpdateSpaceFileContentRpcInputSchema =
  centerAgentSpaceFileScopeSchema.extend({
    action: z.literal("update"),
    baseRevision: spaceFileBaseRevisionSchema.unwrap(),
    clientMutationId: spaceFileClientMutationIdSchema,
    content: z.string(),
    fileId: spaceFileEntryIdSchema,
    mimeType: spaceFileMimeTypeSchema,
  });

export const centerAgentSaveSpaceFileRpcInputSchema = z.discriminatedUnion(
  "action",
  [
    centerAgentCreateSpaceFileRpcInputSchema,
    centerAgentUpdateSpaceFileContentRpcInputSchema,
  ]
);

export const centerAgentSaveSpaceFileResponseSchema = z.strictObject({
  file: spaceFileDescriptorSchema,
});

const centerAgentCreateSpaceFolderRpcInputSchema =
  centerAgentSpaceFileScopeSchema.extend({
    action: z.literal("create_folder"),
    clientMutationId: spaceFileClientMutationIdSchema,
    name: spaceFileNameSchema,
    parentId: spaceFileEntryIdSchema.nullable().optional(),
  });

const centerAgentUpdateSpaceFileEntryRpcInputSchema =
  centerAgentSpaceFileScopeSchema
    .extend({
      action: z.literal("update_entry"),
      clientMutationId: spaceFileClientMutationIdSchema,
      entryId: spaceFileEntryIdSchema,
      name: spaceFileNameSchema.optional(),
      parentId: spaceFileEntryIdSchema.nullable().optional(),
    })
    .refine(
      (value) => value.name !== undefined || value.parentId !== undefined,
      {
        message: "A new name or folder is required.",
      }
    );

const centerAgentTrashSpaceFileEntryRpcInputSchema =
  centerAgentSpaceFileScopeSchema.extend({
    action: z.literal("trash"),
    clientMutationId: spaceFileClientMutationIdSchema,
    entryId: spaceFileEntryIdSchema,
  });

const centerAgentRestoreSpaceFileEntryRpcInputSchema =
  centerAgentSpaceFileScopeSchema.extend({
    action: z.literal("restore"),
    clientMutationId: spaceFileClientMutationIdSchema,
    entryId: spaceFileEntryIdSchema,
  });

const centerAgentRestoreSpaceFileRevisionRpcInputSchema =
  centerAgentSpaceFileScopeSchema.extend({
    action: z.literal("restore_version"),
    baseRevision: spaceFileRevisionNumberSchema,
    clientMutationId: spaceFileClientMutationIdSchema,
    fileId: spaceFileEntryIdSchema,
    revision: spaceFileRevisionNumberSchema,
  });

export const centerAgentManageSpaceFilesRpcInputSchema = z.union([
  centerAgentCreateSpaceFolderRpcInputSchema,
  centerAgentUpdateSpaceFileEntryRpcInputSchema,
  centerAgentTrashSpaceFileEntryRpcInputSchema,
  centerAgentRestoreSpaceFileEntryRpcInputSchema,
  centerAgentRestoreSpaceFileRevisionRpcInputSchema,
]);

export const centerAgentManageSpaceFilesResponseSchema = z.discriminatedUnion(
  "action",
  [
    z.strictObject({
      action: z.literal("create_folder"),
      folder: spaceFolderDescriptorSchema,
    }),
    z.strictObject({
      action: z.literal("update_entry"),
      entry: spaceFileEntrySchema,
    }),
    z.strictObject({
      action: z.literal("trash"),
      entryId: spaceFileEntryIdSchema,
      trashedAt: z.iso.datetime({ offset: true }),
    }),
    z.strictObject({
      action: z.literal("restore"),
      entry: spaceFileEntrySchema,
    }),
    z.strictObject({
      action: z.literal("restore_version"),
      file: spaceFileDescriptorSchema,
    }),
  ]
);
