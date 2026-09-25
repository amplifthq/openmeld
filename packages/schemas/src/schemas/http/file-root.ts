import * as z from "../../lazy-zod";
import { spaceFileUploadResponseSchema } from "./space-file-upload";
import {
  spaceFileBreadcrumbSchema,
  spaceFileCapabilitiesSchema,
  spaceFileDescriptorSchema,
  spaceFileEntryIdSchema,
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
