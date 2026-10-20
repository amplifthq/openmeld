import * as z from "zod/v4";
import {
  runtimeStreamingModeSchema,
  runtimeTransportModeSchema,
} from "./controller-contract";

export const providerRuntimeStreamingCapabilitySchema = z.enum([
  "preview_capable",
  "final_only",
]);

export const providerRuntimeImageInputCapabilitySchema = z.enum([
  "local_file_path",
  "unsupported",
]);

export const providerRuntimeWorkingDirectoryModeSchema = z.enum([
  "spawn_cwd",
  "cli_flag",
  "provider_workspace",
  "unsupported",
]);

export const providerRuntimePreparationRequirementSchema = z.enum([
  "none",
  "required",
]);

export const providerRuntimeContinuationCapabilitySchema = z.enum([
  "standard",
  "provider_specific",
]);

export const providerRuntimeWorkspaceResumeBehaviorSchema = z.enum([
  "transparent",
  "provider_specific_switch",
  "validate_only",
]);

export const providerRuntimeCapabilityDeclarationSchema = z.strictObject({
  executionContextPermissionInheritance: z.literal(true).optional(),
  executionContextVersion: z
    .union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
      // 6: resolves an assignment's folderId (Profile folders).
      z.literal(6),
      // 7: resolves workspaceDefault "isolated_if_git" and reports the chosen
      // workspace in the completion.
      z.literal(7),
    ])
    .optional(),
  streamingCapability: providerRuntimeStreamingCapabilitySchema,
  imageInputCapability: providerRuntimeImageInputCapabilitySchema.optional(),
  runtimeWorkingDirectoryMode: providerRuntimeWorkingDirectoryModeSchema,
  preparationRequirement: providerRuntimePreparationRequirementSchema,
  continuationCapability: providerRuntimeContinuationCapabilitySchema,
  workspaceResumeBehavior: providerRuntimeWorkspaceResumeBehaviorSchema,
});

export const daemonRuntimeAdapterCapabilitySnapshotSchema = z.strictObject({
  adapterId: z.string().min(1),
  transportModes: z.array(runtimeTransportModeSchema).min(1),
  defaultStreamingMode: runtimeStreamingModeSchema.optional(),
  capabilityDeclaration: providerRuntimeCapabilityDeclarationSchema,
});
