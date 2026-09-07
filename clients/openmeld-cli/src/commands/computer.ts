import {
  peopleComputerContainsDevice as computerContainsDevice,
  projectPeopleComputersToLegacyLocalRuntimes,
} from "@openmeld/agent-runtime";
import {
  type CreateCurrentDeviceApi,
  createComputerFileAccessApi,
  createCurrentDeviceApi,
  toStructuredApiClientFailure,
} from "@openmeld/api-client";
import {
  ownerComputerDiagnosticsSchema,
  projectOwnerComputerLocalRuntimes,
  summarizeComputerFileAccessPolicy,
} from "@openmeld/schemas";
import type {
  LocalRuntimeComputer,
  LocalRuntimesResponse,
  OwnerComputerDiagnostics,
  PeopleComputerCliInventory,
} from "@openmeld/schemas/types";
import { resolveBaseUrl } from "../config/base-url";
import { resolveOpenMeldEnvPreset } from "../config/paths";
import { readCurrentLocalDeviceId } from "../local-service/state/current-device-identity";
import { resolveRuntimeContext } from "../runtime/context";
import { createPresenter } from "../runtime/presenter/index";
import { createCliApiClientFoundation } from "../space/api-client-foundation";
import { collectObservedDeviceMetadata } from "../system/observed-device-metadata";

export type RunComputerRenameInput = {
  clear?: boolean;
  nameParts?: readonly string[];
  now?: Date;
  view?: string;
};

export type RunComputerListInput = {
  view?: string;
};

export type RunComputerCurrentInput = {
  brief?: boolean;
  now?: Date;
  view?: string;
};

type CurrentDeviceApi = ReturnType<CreateCurrentDeviceApi>;

export async function runComputerList(
  input: RunComputerListInput
): Promise<void> {
  const runtime = await resolveRuntimeContext({ view: input.view });
  const presenter = createPresenter(runtime);
  const gatewayUrl = await resolveBaseUrl();
  const currentDeviceApi = createCurrentDeviceApi(
    createCliApiClientFoundation(gatewayUrl)
  );
  const localDeviceId = await readCurrentLocalDeviceId();
  const response = await currentDeviceApi.listPeopleComputers({
    includeUsageLimits: "true",
  });

  if (presenter.view === "agent") {
    presenter.data({
      code: "computer.list.completed",
      payload: {
        ...response,
        computers: response.computers.map((computer) => ({
          ...computer,
          isThisComputer:
            localDeviceId !== null &&
            computerContainsDevice(computer, localDeviceId),
        })),
      } satisfies PeopleComputerCliInventory,
    });
    return;
  }

  if (response.computers.length === 0) {
    presenter.line({
      code: "computer.list.empty",
      text: "No computers are registered to this account yet. Run `openmeld setup` on a computer to connect it.",
    });
    return;
  }

  presenter.line({
    code: "computer.list.completed",
    text: "Computers on your account:",
  });
  for (const computer of response.computers) {
    presenter.line({
      code: "computer.list.item",
      text: [
        computer.deviceDisplayName,
        localDeviceId !== null &&
        computerContainsDevice(computer, localDeviceId)
          ? "This computer"
          : null,
        {
          connected: "Connected",
          disconnected: "Disconnected",
          unknown: "Connection status unavailable",
        }[computer.connection.status],
        formatComputerMetadata(computer),
        formatLastSeen(computer.lastObservedAtMs),
      ]
        .filter(Boolean)
        .join(" — "),
    });
  }
}

export async function runComputerCurrent(
  input: RunComputerCurrentInput
): Promise<void> {
  const runtime = await resolveRuntimeContext({ view: input.view });
  const presenter = createPresenter(runtime);
  const deviceId = await readCurrentLocalDeviceId();

  if (!deviceId) {
    throw new Error(
      "OpenMeld could not identify this computer. Run `openmeld setup` or `openmeld service install`, then try again."
    );
  }

  const gatewayUrl = await resolveBaseUrl();
  const apiClient = createCliApiClientFoundation(gatewayUrl);
  const currentDeviceApi = createCurrentDeviceApi(apiClient);

  const inventory = await currentDeviceApi.listPeopleComputers({
    includeUsageLimits: "true",
  });
  const target = { deviceId, runtimeLane: resolveOpenMeldEnvPreset() };
  const response = projectPeopleComputersToLegacyLocalRuntimes(
    inventory,
    target
  );
  const currentComputer = findLocalRuntime(response, deviceId);

  if (input.brief) {
    const readiness =
      await currentDeviceApi.getPeopleComputerReplyReadiness(target);
    const payload = buildCurrentComputerBrief({
      currentComputer,
      readiness,
    });
    if (presenter.view === "agent") {
      presenter.data({ code: "computer.current.brief", payload });
      return;
    }
    presenter.line({
      code: "computer.current.brief",
      text: `${currentComputer.deviceDisplayName}: ${readiness.message}${readiness.nextAction === "none" ? "" : ` Next: ${readiness.localComponents.agentSetupCommand}`}`,
    });
    return;
  }

  if (presenter.view === "agent") {
    const diagnostics = await readCurrentComputerDiagnostics({
      apiClient,
      currentDeviceApi,
      target,
      localRuntimes: response,
    });
    presenter.data({
      code: "computer.current.completed",
      payload: {
        computer: currentComputer,
        currentDeviceId: deviceId,
        diagnostics,
      },
    });
    return;
  }

  presenter.line({
    code: "computer.current.completed",
    text: formatComputerHumanLine(currentComputer),
  });
}

function buildCurrentComputerBrief(input: {
  currentComputer: LocalRuntimeComputer;
  readiness: Awaited<
    ReturnType<CurrentDeviceApi["getCurrentLocalRuntimeReplyReadiness"]>
  >;
}) {
  const { currentComputer, readiness } = input;
  return {
    computer: {
      deviceId: currentComputer.deviceId,
      deviceDisplayName: currentComputer.deviceDisplayName,
      platformFamily: currentComputer.platformFamily,
      isCurrent: currentComputer.isCurrent,
    },
    wake: {
      canReplyFromThisComputer: readiness.canReplyFromThisComputer,
      status: readiness.status,
      primaryBlocker: readiness.primaryBlocker,
      nextAction: readiness.nextAction,
      message: readiness.message,
    },
    updates: {
      setupAction: readiness.localComponents.setupAction,
      setupActionLabel: readiness.localComponents.setupActionLabel,
      agentSetupCommand: readiness.localComponents.agentSetupCommand,
      maintenance: readiness.localComponents.maintenance,
      updateOperation: readiness.localComponents.updateOperation,
      cli: readiness.localComponents.cli,
      service: readiness.localComponents.service,
      skills: readiness.localComponents.skills,
    },
    localAgents: currentComputer.executionTargets.map((target) => ({
      runtimeLane: target.runtimeLane,
      status: target.status,
      reasonCodes: target.reasonCodes,
      agents: target.capabilities.map((capability) => {
        const usageLimits = capability.agentControllerInterface?.usageLimits;
        return {
          agentControllerRef: capability.agentControllerRef,
          enabled: capability.enabled,
          status: capability.status,
          reasonCodes: capability.reasonCodes,
          ...(usageLimits ? { usageLimits } : {}),
        };
      }),
    })),
  };
}

async function readCurrentComputerDiagnostics(input: {
  target: import("@openmeld/schemas/types").PeopleComputerTarget;
  apiClient: ReturnType<typeof createCliApiClientFoundation>;
  currentDeviceApi: CurrentDeviceApi;
  localRuntimes: LocalRuntimesResponse;
}): Promise<OwnerComputerDiagnostics> {
  const [currentLocalRuntimeReplyReadiness, currentComputerFileAccess] =
    await Promise.all([
      input.currentDeviceApi.getPeopleComputerReplyReadiness(input.target),
      readCurrentComputerFileAccessSummary({
        apiClient: input.apiClient,
        target: input.target,
      }),
    ]);
  return ownerComputerDiagnosticsSchema.parse({
    currentComputerFileAccess,
    currentLocalRuntimeReplyReadiness,
    localRuntimes: projectOwnerComputerLocalRuntimes(input.localRuntimes),
  });
}

async function readCurrentComputerFileAccessSummary(input: {
  apiClient: ReturnType<typeof createCliApiClientFoundation>;
  target: import("@openmeld/schemas/types").PeopleComputerTarget;
}): Promise<OwnerComputerDiagnostics["currentComputerFileAccess"]> {
  try {
    const response = await createComputerFileAccessApi(
      input.apiClient
    ).readPeopleComputerPolicy(input.target);
    return summarizeComputerFileAccessPolicy(response);
  } catch (error) {
    const failure = toStructuredApiClientFailure(error);
    return {
      code:
        failure.upstreamCode ??
        failure.code ??
        "computer.file_access.unavailable",
      message: failure.message,
      status: "unavailable",
    };
  }
}

export async function runComputerRename(
  input: RunComputerRenameInput
): Promise<void> {
  const runtime = await resolveRuntimeContext({ view: input.view });
  const presenter = createPresenter(runtime);
  const displayName = resolveRequestedDisplayName(input);
  const deviceId = await readCurrentLocalDeviceId();

  if (!deviceId) {
    throw new Error(
      "OpenMeld could not identify this computer. Run `openmeld setup` or `openmeld service install`, then try again."
    );
  }

  const gatewayUrl = await resolveBaseUrl();
  const currentDeviceApi = createCurrentDeviceApi(
    createCliApiClientFoundation(gatewayUrl)
  );

  await syncCurrentComputerObservation({
    currentDeviceApi,
    deviceId,
    now: input.now,
  });

  const response = await currentDeviceApi.setDisplayName({
    deviceId,
    displayName,
  });
  const renamedDevice = findLocalRuntime(response, deviceId);

  if (presenter.view === "agent") {
    presenter.data({
      code: "computer.rename.completed",
      payload: {
        deviceDisplayName: renamedDevice.deviceDisplayName,
        deviceDisplayNameSource: renamedDevice.deviceDisplayNameSource,
        deviceId: renamedDevice.deviceId,
      },
    });
    return;
  }

  presenter.line({
    code: "computer.rename.completed",
    text:
      displayName === null
        ? "OpenMeld will use this computer's system name again."
        : `Computer renamed to ${renamedDevice.deviceDisplayName}.`,
  });
}

function resolveRequestedDisplayName(
  input: RunComputerRenameInput
): string | null {
  const hasClear = input.clear === true;
  const name = input.nameParts?.join(" ").trim() ?? "";

  if (hasClear && name.length > 0) {
    throw new Error("Use either a computer name or --clear, not both.");
  }

  if (hasClear) {
    return null;
  }

  if (name.length === 0) {
    throw new Error(
      "Provide a computer name, or use `openmeld computer rename --clear` to use this computer's system name again."
    );
  }

  if (name.length > 80) {
    throw new Error("Computer name must be 80 characters or fewer.");
  }

  return name;
}

function findLocalRuntime(
  response: LocalRuntimesResponse,
  deviceId: string
): LocalRuntimesResponse["localRuntimes"][number] {
  const runtime = response.localRuntimes.find((entry) =>
    computerContainsDevice(entry, deviceId)
  );

  if (!runtime) {
    throw new Error(
      "OpenMeld could not find this computer in your account. Run `openmeld setup` or `openmeld service install`, then try again."
    );
  }

  return runtime;
}

async function syncCurrentComputerObservation(input: {
  currentDeviceApi: CurrentDeviceApi;
  deviceId: string;
  now?: Date;
}): Promise<void> {
  await input.currentDeviceApi.writeObservedMetadata({
    deviceId: input.deviceId,
    metadata: await collectObservedDeviceMetadata({ now: input.now }),
  });
}

function formatComputerHumanLine(computer: LocalRuntimeComputer): string {
  return [
    computer.deviceDisplayName,
    computer.isCurrent ? "This computer" : null,
    formatComputerMetadata(computer),
    formatLastSeen(computer.lastObservedAtMs),
  ]
    .filter((part): part is string => Boolean(part))
    .join(" — ");
}

function formatComputerMetadata(
  computer: Pick<
    LocalRuntimeComputer,
    "deviceType" | "osVersion" | "platformFamily"
  >
): string {
  return [
    formatDeviceType(computer.deviceType),
    computer.osVersion
      ? `${computer.platformFamily} ${computer.osVersion}`
      : computer.platformFamily,
  ]
    .filter((part) => part.length > 0)
    .join(" · ");
}

function formatDeviceType(
  deviceType: LocalRuntimeComputer["deviceType"]
): string {
  switch (deviceType) {
    case "desktop":
      return "Desktop";
    case "laptop":
      return "Laptop";
    case "server":
      return "Server";
    case "unknown":
      return "";
    default:
      return "";
  }
}

function formatLastSeen(lastObservedAtMs: number | null): string {
  if (lastObservedAtMs === null) {
    return "Last seen unknown";
  }

  return `Last seen ${new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(lastObservedAtMs))}`;
}
