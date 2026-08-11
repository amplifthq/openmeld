import type { z } from "zod/v4";

type StartBackgroundHelperInstallStatusSchema =
  typeof import("../../schemas/start/device-projection")["startBackgroundHelperInstallStatusSchema"];
type StartBackgroundHelperRuntimeStatusSchema =
  typeof import("../../schemas/start/device-projection")["startBackgroundHelperRuntimeStatusSchema"];
type StartBackgroundHelperExecutionCompatibilitySchema =
  typeof import("../../schemas/start/device-projection")["startBackgroundHelperExecutionCompatibilitySchema"];
type StartSkillsReadinessStatusSchema =
  typeof import("../../schemas/start/device-projection")["startSkillsReadinessStatusSchema"];
type StartDeviceAgentSelectableReasonSchema =
  typeof import("../../schemas/start/device-projection")["startDeviceAgentSelectableReasonSchema"];
type StartDeviceProjectionSchema =
  typeof import("../../schemas/start/device-projection")["startDeviceProjectionSchema"];

export type StartBackgroundHelperInstallStatus =
  z.infer<StartBackgroundHelperInstallStatusSchema>;
export type StartBackgroundHelperRuntimeStatus =
  z.infer<StartBackgroundHelperRuntimeStatusSchema>;
export type StartBackgroundHelperExecutionCompatibility =
  z.infer<StartBackgroundHelperExecutionCompatibilitySchema>;
export type StartSkillsReadinessStatus =
  z.infer<StartSkillsReadinessStatusSchema>;
export type StartDeviceAgentSelectableReason =
  z.infer<StartDeviceAgentSelectableReasonSchema>;
export type StartDeviceProjection = z.infer<StartDeviceProjectionSchema>;
