import type { z } from "zod/v4";

type SpaceCreatorSchema =
  typeof import("../../schemas/http/space-meta")["spaceCreatorSchema"];
type SpaceStorageUsageSchema =
  typeof import("../../schemas/http/space-meta")["spaceStorageUsageSchema"];
type SpaceOrganizationVisibilitySchema =
  typeof import("../../schemas/http/space-meta")["spaceOrganizationVisibilitySchema"];
type SpaceMetaSchema =
  typeof import("../../schemas/http/space-meta")["spaceMetaSchema"];
type PatchSpaceMetaBodySchema =
  typeof import("../../schemas/http/space-meta")["patchSpaceMetaBodySchema"];

export type SpaceCreator = z.infer<SpaceCreatorSchema>;
export type SpaceStorageUsage = z.infer<SpaceStorageUsageSchema>;
export type SpaceOrganizationVisibility =
  z.infer<SpaceOrganizationVisibilitySchema>;
export type SpaceMeta = z.infer<SpaceMetaSchema>;
export type PatchSpaceMetaBody = z.infer<PatchSpaceMetaBodySchema>;
