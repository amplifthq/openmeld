import type {
  AccountSpaceIndexQuery,
  AccountSpaceIndexResponse,
  OpenMeldRequestContext,
} from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";

export type ListAccountSpaceIndexInput = {
  requestContext?: OpenMeldRequestContext;
  gatewayHost: string;
  includePurposes?: boolean;
  includeRecentlyDeletedItems?: boolean;
  limit?: number;
  scope: AccountSpaceIndexQuery["scope"];
  selectedProfileId: string;
  timeoutMs?: number;
};

export type AccountSpaceIndexApi = {
  listAccountSpaces: (
    input: ListAccountSpaceIndexInput
  ) => Promise<AccountSpaceIndexResponse>;
};

export type CreateAccountSpaceIndexApi = (
  client: OpenMeldApiClientFoundation
) => AccountSpaceIndexApi;
