import { peopleComputerContainsDevice } from "@openmeld/agent-runtime";
import type {
  LocalRuntimesResponse,
  PeopleComputerConnection,
  PeopleComputersResponse,
  PeopleComputerTarget,
  RuntimeTransportLookupOwnerServiceResponse,
} from "@openmeld/schemas/types";
import { resolveLocalComponentUpdateProjection } from "../local-components/update-projection";
import { selectCurrentOwnerServiceSessionsByDeviceLane } from "../runtime-transport/application/current-owner-service-sessions";

export function resolvePeopleComputerTarget(input: {
  inventory: LocalRuntimesResponse;
  target: PeopleComputerTarget;
}):
  | ({ availability: "resolved" } & PeopleComputerTarget)
  | { availability: "missing" } {
  return input.inventory.localRuntimes.some((computer) =>
    peopleComputerContainsDevice(computer, input.target.deviceId)
  )
    ? { availability: "resolved", ...input.target }
    : { availability: "missing" };
}

export function projectPeopleComputerConnection(input: {
  deviceIds: readonly string[];
  ownerService: RuntimeTransportLookupOwnerServiceResponse | null;
}): PeopleComputerConnection {
  if (input.ownerService === null) {
    return {
      status: "unknown",
      reasonCodes: ["computer.connection.lookup_failed"],
      sessions: [],
    };
  }
  if (!input.ownerService.online) {
    // A transport lookup failure is not proof of disconnection.
    const disconnected =
      input.ownerService.reasonCode === "daemon.session.not_found" ||
      input.ownerService.reasonCode === "daemon.session.stale_lease" ||
      input.ownerService.reasonCode === "daemon.profile.offline";
    return {
      status: disconnected ? "disconnected" : "unknown",
      reasonCodes: [input.ownerService.reasonCode],
      sessions: [],
    };
  }
  const sessions = selectCurrentOwnerServiceSessionsByDeviceLane(
    input.ownerService
  )
    .filter((session) => input.deviceIds.includes(session.deviceId))
    .map((session) => {
      const updates = resolveLocalComponentUpdateProjection({
        runtimeLane: session.lane,
        generatedAt: new Date(session.lastHeartbeatMs).toISOString(),
        serviceConnected: true,
        serviceVersion: session.serviceVersion ?? null,
        localComponentsStatus: session.capabilities.localComponents ?? null,
      });
      return {
        deviceId: session.deviceId,
        runtimeLane: session.lane,
        lastHeartbeatMs: session.lastHeartbeatMs,
        serviceVersion: session.serviceVersion ?? null,
        executionCompatibility: session.executionCompatibility,
        serviceUpdate: {
          wakeBlocked: updates.service.wakeBlocked,
          reasonCodes: updates.service.reasonCodes,
        },
      };
    });
  return {
    status: sessions.length > 0 ? "connected" : "disconnected",
    reasonCodes:
      sessions.length > 0 ? [] : ["computer.connection.no_live_session"],
    sessions,
  };
}

export function projectPeopleComputers(input: {
  generatedAt: string;
  inventory: LocalRuntimesResponse;
  ownerService: RuntimeTransportLookupOwnerServiceResponse | null;
}): PeopleComputersResponse {
  return {
    generatedAt: input.generatedAt,
    computers: input.inventory.localRuntimes.map((computer) => {
      const {
        connectionStatus: _association,
        isCurrent: _routingPreference,
        executionTargets,
        ...identity
      } = computer;
      return {
        ...identity,
        identityStatus: computer.connectedComputerId
          ? "enrolled"
          : "unconfirmed",
        connection: projectPeopleComputerConnection({
          deviceIds: [
            computer.deviceId,
            ...(computer.legacyDeviceIds ?? []),
            ...executionTargets.map((target) => target.deviceId),
          ],
          ownerService: input.ownerService,
        }),
        executionTargets: executionTargets.map(
          ({ isCurrent: _routingTarget, ...target }) => target
        ),
      };
    }),
  };
}
