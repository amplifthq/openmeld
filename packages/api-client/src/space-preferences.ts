import { spacePreferencesSchema } from "@openmeld/schemas";
import type { OpenMeldApiClientFoundation } from "./client";

export function createSpacePreferencesApi(client: OpenMeldApiClientFoundation) {
  return {
    get: () =>
      client.requestJson({
        method: "GET",
        url: "/v1/account/space-preferences",
        operation: "spaces.preferences.get",
        schema: spacePreferencesSchema,
        invalidMessage: "Invalid Space preferences.",
      }),
    update: (automaticWakeEnabled: boolean) =>
      client.requestJson({
        method: "PATCH",
        url: "/v1/account/space-preferences",
        operation: "spaces.preferences.update",
        schema: spacePreferencesSchema,
        body: JSON.stringify({ automaticWakeEnabled }),
        headers: { "content-type": "application/json" },
        invalidMessage: "Invalid Space preferences.",
      }),
  };
}
