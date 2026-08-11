import type {
  ComputerFileAccessPolicyResponse,
  ComputerFileAccessReadRequest,
  ComputerFileAccessUpdateRequest,
  OpenMeldRequestContext,
} from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";

export type ComputerFileAccessRequestInput = {
  requestContext?: OpenMeldRequestContext;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type ReadComputerFileAccessPolicyInput = ComputerFileAccessRequestInput &
  ComputerFileAccessReadRequest;
export type UpdateComputerFileAccessPolicyInput =
  ComputerFileAccessRequestInput & ComputerFileAccessUpdateRequest;

export type ComputerFileAccessApi = {
  readPolicy: (
    input: ReadComputerFileAccessPolicyInput
  ) => Promise<ComputerFileAccessPolicyResponse>;
  updatePolicy: (
    input: UpdateComputerFileAccessPolicyInput
  ) => Promise<ComputerFileAccessPolicyResponse>;
};

export type CreateComputerFileAccessApi = (
  client: OpenMeldApiClientFoundation
) => ComputerFileAccessApi;
