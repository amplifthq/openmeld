import type { z } from "zod/v4";

type ProfileDetailsContextSchema =
  typeof import("../schemas/profile-details")["profileDetailsContextSchema"];
type ProfileDetailsCopyActionSchema =
  typeof import("../schemas/profile-details")["profileDetailsCopyActionSchema"];
type ProfileDetailsFieldSchema =
  typeof import("../schemas/profile-details")["profileDetailsFieldSchema"];
type ProfileDetailsFieldSourceSchema =
  typeof import("../schemas/profile-details")["profileDetailsFieldSourceSchema"];
type ProfileDetailsFieldValueKindSchema =
  typeof import("../schemas/profile-details")["profileDetailsFieldValueKindSchema"];
type ProfileDetailsFieldVisibilitySchema =
  typeof import("../schemas/profile-details")["profileDetailsFieldVisibilitySchema"];
type ProfileDetailsRecoveryActionKindSchema =
  typeof import("../schemas/profile-details")["profileDetailsRecoveryActionKindSchema"];
type ProfileDetailsRecoveryActionSchema =
  typeof import("../schemas/profile-details")["profileDetailsRecoveryActionSchema"];
type ProfileDetailsSectionIdSchema =
  typeof import("../schemas/profile-details")["profileDetailsSectionIdSchema"];
type ProfileDetailsSectionSchema =
  typeof import("../schemas/profile-details")["profileDetailsSectionSchema"];
type ProfileDetailsSnapshotSchema =
  typeof import("../schemas/profile-details")["profileDetailsSnapshotSchema"];
type ProfileDetailsViewerScopeSchema =
  typeof import("../schemas/profile-details")["profileDetailsViewerScopeSchema"];

export type ProfileDetailsContext = z.infer<ProfileDetailsContextSchema>;
export type ProfileDetailsCopyAction = z.infer<ProfileDetailsCopyActionSchema>;
export type ProfileDetailsField = z.infer<ProfileDetailsFieldSchema>;
export type ProfileDetailsFieldSource =
  z.infer<ProfileDetailsFieldSourceSchema>;
export type ProfileDetailsFieldValueKind =
  z.infer<ProfileDetailsFieldValueKindSchema>;
export type ProfileDetailsFieldVisibility =
  z.infer<ProfileDetailsFieldVisibilitySchema>;
export type ProfileDetailsRecoveryActionKind =
  z.infer<ProfileDetailsRecoveryActionKindSchema>;
export type ProfileDetailsRecoveryAction =
  z.infer<ProfileDetailsRecoveryActionSchema>;
export type ProfileDetailsSectionId = z.infer<ProfileDetailsSectionIdSchema>;
export type ProfileDetailsSection = z.infer<ProfileDetailsSectionSchema>;
export type ProfileDetailsSnapshot = z.infer<ProfileDetailsSnapshotSchema>;
export type ProfileDetailsViewerScope =
  z.infer<ProfileDetailsViewerScopeSchema>;
