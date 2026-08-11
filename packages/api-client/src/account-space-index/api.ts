import { accountSpaceIndexResponseSchema } from "@openmeld/schemas";
import type { OpenMeldApiClientFoundation } from "../client";
import { buildAccountSpaceIndexPath } from "./routes";
import type { CreateAccountSpaceIndexApi } from "./types";

export const createAccountSpaceIndexApi: CreateAccountSpaceIndexApi = (
  client: OpenMeldApiClientFoundation
) => {
  return {
    listAccountSpaces: async (input) =>
      await client.requestJson({
        url: buildAccountSpaceIndexPath(input),
        operation: "account_space_index.list",
        method: "GET",
        requestContext: input.requestContext,
        timeoutMs: input.timeoutMs,
        schema: accountSpaceIndexResponseSchema,
        invalidMessage: "invalid account space index response",
      }),
  };
};
