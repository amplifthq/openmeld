import * as z from "../../lazy-zod";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";
import { centerAgentVerifiedMemberToolSpeakerSchema } from "./center-agent-speaker";
import { spaceFileUploadResponseSchema } from "./space-file-upload";
import {
  spaceFileBaseRevisionSchema,
  spaceFileBreadcrumbSchema,
  spaceFileCapabilitiesSchema,
  spaceFileClientMutationIdSchema,
  spaceFileDescriptorSchema,
  spaceFileEntryIdSchema,
  spaceFileMimeTypeSchema,
  spaceFileNameSchema,
  spaceFileRevisionNumberSchema,
  spaceFileRevisionSchema,
  spaceFolderDescriptorSchema,
} from "./space-files";

const rootIdSchema = z.string().trim().min(1).max(512);

/** A file belongs to exactly one Organization-scoped location. */
export const fileRootSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("team"),
    organizationId: rootIdSchema,
  }),
  z.strictObject({
    kind: z.literal("member"),
    organizationId: rootIdSchema,
    memberUserId: rootIdSchema,
  }),
  z.strictObject({
    kind: z.literal("space"),
    organizationId: rootIdSchema,
    spaceId: rootIdSchema,
  }),
]);

export const fileRootFolderDescriptorSchema = spaceFolderDescriptorSchema
  .omit({ spaceId: true })
  .extend({ root: fileRootSchema });

export const fileRootFileDescriptorSchema = spaceFileDescriptorSchema
  .omit({ spaceId: true })
  .extend({ root: fileRootSchema });

export const fileRootFileResponseSchema = z.strictObject({
  file: fileRootFileDescriptorSchema,
});

export const remoteAgentListTeamFilesRpcInputSchema = z.strictObject({
  context: openMeldRequestContextSchema,
  speakerMember: centerAgentVerifiedMemberToolSpeakerSchema.optional(),
  parentId: spaceFileEntryIdSchema.nullable().optional(),
  view: z.enum(["active", "trash"]).optional(),
});

export const remoteAgentReadTeamFileRpcInputSchema = z.strictObject({
  context: openMeldRequestContextSchema,
  speakerMember: centerAgentVerifiedMemberToolSpeakerSchema.optional(),
  fileId: spaceFileEntryIdSchema,
  revision: spaceFileRevisionNumberSchema.optional(),
  includeHistory: z.boolean().optional(),
});

export const remoteAgentReadTeamFileResponseSchema = z.strictObject({
  content: z.string(),
  file: fileRootFileDescriptorSchema,
  revision: spaceFileRevisionSchema,
  revisions: z.array(spaceFileRevisionSchema).optional(),
});

export const remoteAgentSaveTeamFileRpcInputSchema = z.discriminatedUnion(
  "action",
  [
    z.strictObject({
      context: openMeldRequestContextSchema,
      speakerMember: centerAgentVerifiedMemberToolSpeakerSchema.optional(),
      action: z.literal("create"),
      clientMutationId: spaceFileClientMutationIdSchema,
      content: z.string(),
      mimeType: spaceFileMimeTypeSchema,
      name: spaceFileNameSchema,
      parentId: spaceFileEntryIdSchema.nullable().optional(),
    }),
    z.strictObject({
      context: openMeldRequestContextSchema,
      speakerMember: centerAgentVerifiedMemberToolSpeakerSchema.optional(),
      action: z.literal("update"),
      baseRevision: spaceFileBaseRevisionSchema.unwrap(),
      clientMutationId: spaceFileClientMutationIdSchema,
      content: z.string(),
      fileId: spaceFileEntryIdSchema,
      mimeType: spaceFileMimeTypeSchema,
    }),
  ]
);

export const remoteAgentSaveTeamFileResponseSchema = z.strictObject({
  file: fileRootFileDescriptorSchema,
});

/** Copy one immutable revision into a new Team or member-owned file. */
const copyRevisionFields = {
  sourceFileId: spaceFileEntryIdSchema,
  sourceRevision: spaceFileRevisionNumberSchema,
  name: spaceFileNameSchema,
  parentId: spaceFileEntryIdSchema.nullable(),
  clientMutationId: spaceFileClientMutationIdSchema,
};

export const copyFileRootRevisionBodySchema = z.discriminatedUnion(
  "sourceLocation",
  [
    z.strictObject({
      ...copyRevisionFields,
      sourceLocation: z.enum(["team", "my"]),
    }),
    z.strictObject({
      ...copyRevisionFields,
      sourceLocation: z.literal("space"),
      sourceSpaceId: z.string().regex(/^[a-f0-9]{64}$/u),
    }),
  ]
);

export const copyFileRootToSpaceBodySchema = z.strictObject({
  ...copyRevisionFields,
  sourceLocation: z.enum(["team", "my"]),
});

export const copyFileRootRevisionResponseSchema = z.strictObject({
  file: fileRootFileDescriptorSchema,
  source: z.strictObject({
    root: fileRootSchema,
    fileId: spaceFileEntryIdSchema,
    revision: spaceFileRevisionNumberSchema,
    revisionId: z.string().min(1),
  }),
});

export const fileRootUploadResponseSchema = spaceFileUploadResponseSchema
  .omit({ file: true, upload: true })
  .extend({ file: fileRootFileDescriptorSchema.optional() });

export const listFileRootRevisionsResponseSchema = z.strictObject({
  file: fileRootFileDescriptorSchema,
  revisions: z.array(spaceFileRevisionSchema),
});

export const fileRootFolderResponseSchema = z.strictObject({
  folder: fileRootFolderDescriptorSchema,
});

export const fileRootEntrySchema = z.discriminatedUnion("kind", [
  fileRootFolderDescriptorSchema,
  fileRootFileDescriptorSchema,
]);

export const fileRootEntryResponseSchema = z.strictObject({
  entry: fileRootEntrySchema,
});

export const listFileRootResponseSchema = z.strictObject({
  root: fileRootSchema,
  parentId: spaceFileEntryIdSchema.nullable(),
  view: z.enum(["active", "trash"]),
  breadcrumbs: z.array(spaceFileBreadcrumbSchema),
  entries: z.array(fileRootEntrySchema),
  capabilities: spaceFileCapabilitiesSchema,
});
