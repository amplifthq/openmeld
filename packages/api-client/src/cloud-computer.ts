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
        // Include cold startup and bounded polls. The foreground shell returns
        // only at exit, so its transport deadline must follow its execution limit.
        timeoutMs:
          operation.action === "command" &&
          operation.command.action === "start" &&
          operation.command.backend === "worker-shell"
            ? ((operation.command.timeoutSeconds ?? 300) + 10) * 1000
            : 60_000,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(operation),
        schema: cloudComputerResponseSchema,
        invalidMessage: "Invalid Computer operation response.",
      }),
  };
}
