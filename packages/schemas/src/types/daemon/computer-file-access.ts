import type { z } from "zod/v4";

type ComputerFileAccessSchemas =
  typeof import("../../schemas/daemon/computer-file-access");

export type ComputerFileAccessMode = z.infer<
  ComputerFileAccessSchemas["computerFileAccessModeSchema"]
>;
export type ComputerFileAccessPolicyInput = z.infer<
  ComputerFileAccessSchemas["computerFileAccessPolicyInputSchema"]
>;
export type ComputerFileAccessPolicy = z.infer<
  ComputerFileAccessSchemas["computerFileAccessPolicySchema"]
>;
export type ComputerFileAccessReadRequest = z.infer<
  ComputerFileAccessSchemas["computerFileAccessReadRequestSchema"]
>;
export type ComputerFileAccessUpdateRequest = z.infer<
  ComputerFileAccessSchemas["computerFileAccessUpdateRequestSchema"]
>;
export type ComputerFileAccessPolicyResponse = z.infer<
  ComputerFileAccessSchemas["computerFileAccessPolicyResponseSchema"]
>;
export type ComputerFileAccessErrorCode = z.infer<
  ComputerFileAccessSchemas["computerFileAccessErrorCodeSchema"]
>;
export type ComputerFileAccessErrorResponse = z.infer<
  ComputerFileAccessSchemas["computerFileAccessErrorResponseSchema"]
>;
export type ComputerFileAccessPolicyResult = z.infer<
  ComputerFileAccessSchemas["computerFileAccessPolicyResultSchema"]
>;
export type ComputerFileAccessReadRpcInput = z.infer<
  ComputerFileAccessSchemas["computerFileAccessReadRpcInputSchema"]
>;
export type ComputerFileAccessUpdateRpcInput = z.infer<
  ComputerFileAccessSchemas["computerFileAccessUpdateRpcInputSchema"]
>;
export type ComputerFileAccessDaemonFrame = z.infer<
  ComputerFileAccessSchemas["computerFileAccessDaemonFrameSchema"]
>;
export type RuntimeTransportComputerFileAccessReadRequest = z.infer<
  ComputerFileAccessSchemas["runtimeTransportComputerFileAccessReadRequestSchema"]
>;
export type RuntimeTransportComputerFileAccessUpdateRequest = z.infer<
  ComputerFileAccessSchemas["runtimeTransportComputerFileAccessUpdateRequestSchema"]
>;
