import {
  type CloudComputerOperation,
  cloudComputerResponseSchema,
} from "@openmeld/schemas";
import type { OpenMeldApiClientFoundation } from "./client";

export function createCloudComputerApi(client: OpenMeldApiClientFoundation) {
  return {
    read: () =>
      client.requestJson({
        url: "/v1/computer/cloud",
        operation: "cloud_computer.read",
        method: "GET",
        schema: cloudComputerResponseSchema,
        invalidMessage: "Invalid Computer response.",
      }),
    execute: (operation: CloudComputerOperation) =>
      client.requestJson({
        url: "/v1/computer/cloud",
        operation: "cloud_computer.execute",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(operation),
        schema: cloudComputerResponseSchema,
        invalidMessage: "Invalid Computer operation response.",
      }),
  };
}
