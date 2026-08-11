import type { z } from "zod/v4";

type CurrentDeviceTargetMissingSchema =
  typeof import("../../schemas/http/current-device-target")["currentDeviceTargetMissingSchema"];
type CurrentDeviceTargetResolvedSchema =
  typeof import("../../schemas/http/current-device-target")["currentDeviceTargetResolvedSchema"];
type CurrentDeviceTargetResponseSchema =
  typeof import("../../schemas/http/current-device-target")["currentDeviceTargetResponseSchema"];
type ForgetCurrentComputerResponseSchema =
  typeof import("../../schemas/http/current-device-target")["forgetCurrentComputerResponseSchema"];
type ForgetComputerResponseSchema =
  typeof import("../../schemas/http/current-device-target")["forgetComputerResponseSchema"];
type ForgetComputerRouteParamsSchema =
  typeof import("../../schemas/http/current-device-target")["forgetComputerRouteParamsSchema"];
type LocalRuntimeEnrollmentBodySchema =
  typeof import("../../schemas/http/current-device-target")["localRuntimeEnrollmentBodySchema"];
type LocalRuntimeEnrollmentResponseSchema =
  typeof import("../../schemas/http/current-device-target")["localRuntimeEnrollmentResponseSchema"];

export type CurrentDeviceTargetMissing =
  z.infer<CurrentDeviceTargetMissingSchema>;
export type CurrentDeviceTargetResolved =
  z.infer<CurrentDeviceTargetResolvedSchema>;
export type CurrentDeviceTargetResponse =
  z.infer<CurrentDeviceTargetResponseSchema>;
export type ForgetCurrentComputerResponse =
  z.infer<ForgetCurrentComputerResponseSchema>;
export type ForgetComputerResponse = z.infer<ForgetComputerResponseSchema>;
export type ForgetComputerRouteParams =
  z.infer<ForgetComputerRouteParamsSchema>;
export type LocalRuntimeEnrollmentBody =
  z.infer<LocalRuntimeEnrollmentBodySchema>;
export type LocalRuntimeEnrollmentResponse =
  z.infer<LocalRuntimeEnrollmentResponseSchema>;
