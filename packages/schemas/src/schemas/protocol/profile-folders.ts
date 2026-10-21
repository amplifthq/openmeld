import * as z from "zod/v4";
import { profileWorkingDirectorySchema } from "./profile";

// Working folders of one local Agent Profile on one computer. The OpenMeld
// Service mints folder ids and is the only writer of the local envelope.
export const MAX_PROFILE_FOLDERS = 32;
export const MAX_PROFILE_FOLDER_DISPLAY_NAME_LENGTH = 120;

export const profileFolderIdSchema = z.uuid();
export const profileFolderKindSchema = z.enum([
  "custom",
  "project",
  "openmeld_managed",
]);
export const profileFolderDisplayNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_PROFILE_FOLDER_DISPLAY_NAME_LENGTH);
const profileFolderProjectIdSchema = z.string().trim().min(1).max(256);

/**
 * Cloud-safe folder fact. It has no path field by design: Core, Web and the
 * Center Agent choose folders by id and display name only.
 */
export const profileFolderProjectionEntrySchema = z
  .strictObject({
    folderId: profileFolderIdSchema,
    kind: profileFolderKindSchema,
    displayName: profileFolderDisplayNameSchema,
    isDefault: z.boolean(),
    // Cloud Project id of a Project folder; lets its owner make that Project
    // the Default Project. Never a path.
    projectId: z.string().trim().min(1).max(256).optional(),
  })
  .refine((entry) => (entry.kind === "project") === Boolean(entry.projectId), {
    message: "Only a Project folder carries its Project id.",
    path: ["projectId"],
  });

export const profileFolderProjectionSchema = z
  .strictObject({
    folders: z
      .array(profileFolderProjectionEntrySchema)
      .max(MAX_PROFILE_FOLDERS),
    defaultFolderId: profileFolderIdSchema.nullable(),
    // Service-local counter, bumped by every folder save. Core keeps the
    // highest one, so a late older receipt never replaces a newer list.
    revision: z.number().int().nonnegative(),
  })
  .superRefine((value, context) => {
    const ids = new Set(value.folders.map((folder) => folder.folderId));
    if (ids.size !== value.folders.length) {
      context.addIssue({
        code: "custom",
        message: "Folder ids must be unique.",
        path: ["folders"],
      });
    }
    const defaults = value.folders.filter((folder) => folder.isDefault);
    if (
      value.defaultFolderId === null
        ? defaults.length !== 0
        : defaults.length !== 1 ||
          defaults[0]?.folderId !== value.defaultFolderId
    ) {
      context.addIssue({
        code: "custom",
        message: "Exactly the default folder must be marked as default.",
        path: ["defaultFolderId"],
      });
    }
  });

const optionalDisplayName = {
  displayName: profileFolderDisplayNameSchema.optional(),
};

/** Owner-requested folder change, carried from Core to the exact Service. */
export const profileFolderOperationSchema = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("list") }),
  z.strictObject({
    operation: z.literal("add_custom"),
    path: profileWorkingDirectorySchema,
    ...optionalDisplayName,
  }),
  z.strictObject({
    operation: z.literal("add_project"),
    organizationId: z.string().trim().min(1).max(256),
    projectId: profileFolderProjectIdSchema,
    ...optionalDisplayName,
  }),
  z.strictObject({
    operation: z.literal("add_openmeld_managed"),
    ...optionalDisplayName,
  }),
  z.strictObject({
    operation: z.literal("set_default"),
    folderId: profileFolderIdSchema,
  }),
  z.strictObject({
    operation: z.literal("remove"),
    folderId: profileFolderIdSchema,
    nextDefaultFolderId: profileFolderIdSchema.optional(),
  }),
  z.strictObject({
    operation: z.literal("rename"),
    folderId: profileFolderIdSchema,
    displayName: profileFolderDisplayNameSchema,
  }),
  // Makes an OpenMeld or custom folder the default, adding it when missing.
  // It is the only change accepted while the saved folder settings can't be
  // read: it then replaces them with a list holding just this folder.
  z.strictObject({
    operation: z.literal("repair"),
    folder: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("openmeld_managed") }),
      z.strictObject({
        kind: z.literal("custom"),
        path: profileWorkingDirectorySchema,
      }),
    ]),
  }),
]);

export const profileFolderOperationReasonCodeSchema = z.enum([
  "profile_folder.not_found",
  "profile_folder.default_removal_requires_replacement",
  "profile_folder.project_default_unsupported",
  "profile_folder.project_not_connected",
  "profile_folder.limit_reached",
  "profile_folder.path_invalid",
  "profile_folder.configuration_invalid",
  "profile_folder.operation_failed",
]);
