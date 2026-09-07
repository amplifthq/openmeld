import { peopleComputerContainsDevice } from "@openmeld/agent-runtime";
import { peopleComputerTargetSchema } from "@openmeld/schemas";
import type {
  LocalRuntimesResponse,
  PeopleComputerTarget,
  RuntimeTransportLookupOwnerServiceResponse,
} from "@openmeld/schemas/types";
import { createCoreRpcHttpError } from "../rpc/errors";
import { selectCurrentOwnerServiceSessionsByDeviceLane } from "../runtime-transport/application/current-owner-service-sessions";
import { projectPeopleComputerConnection } from "./projection";

/** Authorization and liveness are checked again at the mutation boundary.
 * Selecting an enrolled computer never silently changes the requested device/lane.
 */
export function requirePeopleComputerControlSession(input: {
  target: PeopleComputerTarget;
  inventory: LocalRuntimesResponse;
  ownerService: RuntimeTransportLookupOwnerServiceResponse;
}) {
  const parsed = peopleComputerTargetSchema.safeParse(input.target);
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      code: "invalid_payload",
      reason: "Invalid computer target.",
    });
  }
  const target = parsed.data;
  if (
    !input.inventory.localRuntimes.some((computer) =>
      peopleComputerContainsDevice(computer, target.deviceId)
    )
  ) {
    throw createCoreRpcHttpError({
      status: 404,
      code: "computer.not_found",
      reason: "This computer is not available on your account.",
    });
  }
  const session = input.ownerService.online
    ? selectCurrentOwnerServiceSessionsByDeviceLane(input.ownerService).find(
        (entry) =>
          entry.deviceId === target.deviceId &&
          entry.lane === target.runtimeLane
      )
    : undefined;
  if (!session) {
    const connection = projectPeopleComputerConnection({
      deviceIds: [target.deviceId],
      ownerService: input.ownerService,
    });
    const unknown = connection.status === "unknown";
    throw createCoreRpcHttpError({
      status: 503,
      code: unknown
        ? "computer.connection.unavailable"
        : "computer.target_disconnected",
      reason: unknown
        ? "OpenMeld could not check this computer's connection. Try again."
        : "OpenMeld Service is disconnected in this environment on this computer. Reconnect it to use this action.",
    });
  }
  return session;
}
