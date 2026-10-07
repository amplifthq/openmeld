import {
  type FirstWorkAction,
  firstWorkActionSchema,
  firstWorkResponseSchema,
} from "@openmeld/schemas";
import type { OpenMeldApiClientFoundation } from "./client";

export function createFirstWorkApi(client: OpenMeldApiClientFoundation) {
  const url = "/v1/organizations/current/first-work";
  return {
    read: (signal?: AbortSignal) =>
      client.requestJson({
        url,
        operation: "onboarding.first-work.read",
        schema: firstWorkResponseSchema,
        invalidMessage: "Invalid onboarding response",
        signal,
      }),
    update: (input: FirstWorkAction) =>
      client.requestJson({
        url,
        method: "POST",
        operation: "onboarding.first-work.update",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(firstWorkActionSchema.parse(input)),
        schema: firstWorkResponseSchema,
        invalidMessage: "Invalid onboarding response",
      }),
  };
}
