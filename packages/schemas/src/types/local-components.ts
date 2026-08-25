import type { z } from "zod/v4";

type InstalledLocalComponentsSnapshotSchema =
  typeof import("../schemas/local-components")["installedLocalComponentsSnapshotSchema"];
type LocalCliComponentUpdateProjectionSchema =
  typeof import("../schemas/local-components")["localCliComponentUpdateProjectionSchema"];
type LocalCliComponentProjectionSchema =
  typeof import("../schemas/local-components")["localCliComponentProjectionSchema"];
type LocalComponentUpdatePolicySchema =
  typeof import("../schemas/local-components")["localComponentUpdatePolicySchema"];
type LocalComponentUpdateProjectionSchema =
  typeof import("../schemas/local-components")["localComponentUpdateProjectionSchema"];
type LocalComponentUpdateStatusSchema =
  typeof import("../schemas/local-components")["localComponentUpdateStatusSchema"];
type LocalComponentStatusSchema =
  typeof import("../schemas/local-components")["localComponentStatusSchema"];
type LocalComponentsManifestSchema =
  typeof import("../schemas/local-components")["localComponentsManifestSchema"];
type LocalComponentsReleaseManifestSchema =
  typeof import("../schemas/local-components")["localComponentsReleaseManifestSchema"];
type LocalComponentsStatusSchema =
  typeof import("../schemas/local-components")["localComponentsStatusSchema"];
type LocalServiceComponentProjectionSchema =
  typeof import("../schemas/local-components")["localServiceComponentProjectionSchema"];
type LocalServiceComponentUpdateProjectionSchema =
  typeof import("../schemas/local-components")["localServiceComponentUpdateProjectionSchema"];
type LocalSetupActionSchema =
  typeof import("../schemas/local-components")["localSetupActionSchema"];
type LocalSetupEntrypointSchema =
  typeof import("../schemas/local-components")["localSetupEntrypointSchema"];
type LocalSkillsComponentProjectionSchema =
  typeof import("../schemas/local-components")["localSkillsComponentProjectionSchema"];
type LocalSkillsComponentUpdateProjectionSchema =
  typeof import("../schemas/local-components")["localSkillsComponentUpdateProjectionSchema"];
type OpenMeldToolsUpdateOperationSchema =
  typeof import("../schemas/local-components")["openMeldToolsUpdateOperationSchema"];
type OpenMeldToolsUpdateOperationPhaseSchema =
  typeof import("../schemas/local-components")["openMeldToolsUpdateOperationPhaseSchema"];
type OpenMeldToolsUpdateRequestSourceSchema =
  typeof import("../schemas/local-components")["openMeldToolsUpdateRequestSourceSchema"];

export type InstalledLocalComponentsSnapshot =
  z.infer<InstalledLocalComponentsSnapshotSchema>;
export type LocalCliComponentProjection =
  z.infer<LocalCliComponentProjectionSchema>;
export type LocalCliComponentUpdateProjection =
  z.infer<LocalCliComponentUpdateProjectionSchema>;
export type LocalComponentUpdatePolicy =
  z.infer<LocalComponentUpdatePolicySchema>;
export type LocalComponentUpdateProjection =
  z.infer<LocalComponentUpdateProjectionSchema>;
export type LocalComponentUpdateStatus =
  z.infer<LocalComponentUpdateStatusSchema>;
export type LocalComponentStatus = z.infer<LocalComponentStatusSchema>;
export type LocalComponentsManifest = z.infer<LocalComponentsManifestSchema>;
export type LocalComponentsReleaseManifest =
  z.infer<LocalComponentsReleaseManifestSchema>;
export type LocalComponentsStatus = z.infer<LocalComponentsStatusSchema>;
export type LocalServiceComponentProjection =
  z.infer<LocalServiceComponentProjectionSchema>;
export type LocalServiceComponentUpdateProjection =
  z.infer<LocalServiceComponentUpdateProjectionSchema>;
export type LocalSetupAction = z.infer<LocalSetupActionSchema>;
export type LocalSetupEntrypoint = z.infer<LocalSetupEntrypointSchema>;
export type LocalSkillsComponentProjection =
  z.infer<LocalSkillsComponentProjectionSchema>;
export type LocalSkillsComponentUpdateProjection =
  z.infer<LocalSkillsComponentUpdateProjectionSchema>;
export type OpenMeldToolsUpdateOperation =
  z.infer<OpenMeldToolsUpdateOperationSchema>;
export type OpenMeldToolsUpdateOperationPhase =
  z.infer<OpenMeldToolsUpdateOperationPhaseSchema>;
export type OpenMeldToolsUpdateRequestSource =
  z.infer<OpenMeldToolsUpdateRequestSourceSchema>;
