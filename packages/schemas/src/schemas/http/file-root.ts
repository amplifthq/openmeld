import * as z from "../../lazy-zod";
import { spaceFileUploadResponseSchema } from "./space-file-upload";
import {
  spaceFileBreadcrumbSchema,
  spaceFileCapabilitiesSchema,
  spaceFileClientMutationIdSchema,
  spaceFileDescriptorSchema,
  spaceFileEntryIdSchema,
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

/** Copy one immutable revision into a new Team or member-owned file. */
export const copyFileRootRevisionBodySchema = z.strictObject({
  sourceLocation: z.enum(["team", "my"]),
  sourceFileId: spaceFileEntryIdSchema,
  sourceRevision: spaceFileRevisionNumberSchema,
  name: spaceFileNameSchema,
  parentId: spaceFileEntryIdSchema.nullable(),
  clientMutationId: spaceFileClientMutationIdSchema,
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
