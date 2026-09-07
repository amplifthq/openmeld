import type {
  ComputerFileAccessPolicyResponse,
  ComputerFileAccessReadRequest,
  ComputerFileAccessUpdateRequest,
  OpenMeldRequestContext,
  PeopleComputerFileAccessUpdateBody,
  PeopleComputerTarget,
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
  readPeopleComputerPolicy: (
    input: ComputerFileAccessRequestInput & PeopleComputerTarget
  ) => Promise<ComputerFileAccessPolicyResponse>;
  updatePeopleComputerPolicy: (
    input: ComputerFileAccessRequestInput &
      PeopleComputerTarget &
      PeopleComputerFileAccessUpdateBody
  ) => Promise<ComputerFileAccessPolicyResponse>;
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
