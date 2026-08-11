import type { z } from "zod/v4";

type RuntimeReportingChannelSchema =
  typeof import("../../schemas/daemon/runtime-reporting-health")["runtimeReportingChannelSchema"];
type RuntimeReportingChannelHealthSchema =
  typeof import("../../schemas/daemon/runtime-reporting-health")["runtimeReportingChannelHealthSchema"];
type RuntimeReportingHealthFailureSchema =
  typeof import("../../schemas/daemon/runtime-reporting-health")["runtimeReportingHealthFailureSchema"];
type RuntimeReportingHealthStateSchema =
  typeof import("../../schemas/daemon/runtime-reporting-health")["runtimeReportingHealthStateSchema"];
type RuntimeReportingServiceIdentitySchema =
  typeof import("../../schemas/daemon/runtime-reporting-health")["runtimeReportingServiceIdentitySchema"];

export type RuntimeReportingChannel = z.infer<RuntimeReportingChannelSchema>;
export type RuntimeReportingChannelHealth =
  z.infer<RuntimeReportingChannelHealthSchema>;
export type RuntimeReportingHealthFailure =
  z.infer<RuntimeReportingHealthFailureSchema>;
export type RuntimeReportingHealthState =
  z.infer<RuntimeReportingHealthStateSchema>;
export type RuntimeReportingServiceIdentity =
  z.infer<RuntimeReportingServiceIdentitySchema>;
