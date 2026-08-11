import type { z } from "zod/v4";

type ProviderRuntimeStreamingCapabilitySchema =
  typeof import("../../schemas/daemon/provider-runtime-capability")["providerRuntimeStreamingCapabilitySchema"];
type ProviderRuntimeImageInputCapabilitySchema =
  typeof import("../../schemas/daemon/provider-runtime-capability")["providerRuntimeImageInputCapabilitySchema"];
type ProviderRuntimeWorkingDirectoryModeSchema =
  typeof import("../../schemas/daemon/provider-runtime-capability")["providerRuntimeWorkingDirectoryModeSchema"];
type ProviderRuntimePreparationRequirementSchema =
  typeof import("../../schemas/daemon/provider-runtime-capability")["providerRuntimePreparationRequirementSchema"];
type ProviderRuntimeContinuationCapabilitySchema =
  typeof import("../../schemas/daemon/provider-runtime-capability")["providerRuntimeContinuationCapabilitySchema"];
type ProviderRuntimeCapabilityDeclarationSchema =
  typeof import("../../schemas/daemon/provider-runtime-capability")["providerRuntimeCapabilityDeclarationSchema"];
type DaemonRuntimeAdapterCapabilitySnapshotSchema =
  typeof import("../../schemas/daemon/provider-runtime-capability")["daemonRuntimeAdapterCapabilitySnapshotSchema"];

export type ProviderRuntimeStreamingCapability =
  z.infer<ProviderRuntimeStreamingCapabilitySchema>;
export type ProviderRuntimeImageInputCapability =
  z.infer<ProviderRuntimeImageInputCapabilitySchema>;
export type ProviderRuntimeWorkingDirectoryMode =
  z.infer<ProviderRuntimeWorkingDirectoryModeSchema>;
export type ProviderRuntimePreparationRequirement =
  z.infer<ProviderRuntimePreparationRequirementSchema>;
export type ProviderRuntimeContinuationCapability =
  z.infer<ProviderRuntimeContinuationCapabilitySchema>;
export type ProviderRuntimeCapabilityDeclaration =
  z.infer<ProviderRuntimeCapabilityDeclarationSchema>;
export type DaemonRuntimeAdapterCapabilitySnapshot =
  z.infer<DaemonRuntimeAdapterCapabilitySnapshotSchema>;
