import * as z from "../../lazy-zod";
import {
  spaceFileBreadcrumbSchema,
  spaceFileCapabilitiesSchema,
  spaceFileDescriptorSchema,
  spaceFileEntryIdSchema,
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

export const fileRootEntrySchema = z.discriminatedUnion("kind", [
  fileRootFolderDescriptorSchema,
  fileRootFileDescriptorSchema,
]);

export const listFileRootResponseSchema = z.strictObject({
  root: fileRootSchema,
  parentId: spaceFileEntryIdSchema.nullable(),
  view: z.enum(["active", "trash"]),
  breadcrumbs: z.array(spaceFileBreadcrumbSchema),
  entries: z.array(fileRootEntrySchema),
  capabilities: spaceFileCapabilitiesSchema,
});
