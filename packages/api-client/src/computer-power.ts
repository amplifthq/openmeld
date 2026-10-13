import {
  computerPowerRequestSchema,
  computerPowerStateSchema,
  computerPowerTargetSchema,
} from "@openmeld/schemas";
import type {
  ComputerPowerRequest,
  PeopleComputerTarget,
} from "@openmeld/schemas/types";
import type { CreateComputerFileAccessApi } from "./computer-file-access/types";

export function createComputerPowerApi(
  client: Parameters<CreateComputerFileAccessApi>[0]
) {
  return async (
    target: PeopleComputerTarget,
    request: ComputerPowerRequest
  ) => {
    const parsed = computerPowerTargetSchema.parse(target);
    return await client.requestJson({
      method: "POST",
      operation: "people-computer.power-settings",
      schema: computerPowerStateSchema,
      invalidMessage: "Invalid sleep prevention response.",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(computerPowerRequestSchema.parse(request)),
      url: `/v1/people-computers/${encodeURIComponent(parsed.deviceId)}/lanes/${encodeURIComponent(parsed.runtimeLane)}/power-settings`,
    });
  };
}
