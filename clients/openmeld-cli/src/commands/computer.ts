import {
  type CreateCurrentDeviceApi,
  createCurrentDeviceApi,
} from "@openmeld/api-client";
import type {
  LocalRuntimeComputer,
  LocalRuntimesResponse,
} from "@openmeld/schemas/types";
import { resolveBaseUrl } from "../config/base-url";
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
  await syncCurrentComputerObservationIfAvailable({ currentDeviceApi });
  const response = await currentDeviceApi.listLocalRuntimes();

  if (presenter.view === "agent") {
    presenter.data({
      code: "computer.list.completed",
      payload: response,
    });
    return;
  }

  if (response.localRuntimes.length === 0) {
    presenter.line({
      code: "computer.list.empty",
      text: "No computers are connected to this account yet. Run `openmeld setup` on a computer to set it up.",
    });
    return;
  }

  presenter.line({
    code: "computer.list.completed",
    text: "Computers on your account:",
  });
  for (const computer of response.localRuntimes) {
    presenter.line({
      code: "computer.list.item",
      text: formatComputerHumanLine(computer),
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
  const currentDeviceApi = createCurrentDeviceApi(
    createCliApiClientFoundation(gatewayUrl)
  );

  await syncCurrentComputerObservation({
    currentDeviceApi,
    deviceId,
    now: input.now,
  });

  const response = await currentDeviceApi.listLocalRuntimes();
  const currentComputer = findLocalRuntime(response, deviceId);

  if (presenter.view === "agent") {
    presenter.data({
      code: "computer.current.completed",
      payload: {
        computer: currentComputer,
        currentDeviceId: response.currentDeviceId,
      },
    });
    return;
  }

  presenter.line({
    code: "computer.current.completed",
    text: formatComputerHumanLine(currentComputer),
  });
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
  const runtime = response.localRuntimes.find(
    (entry) => entry.deviceId === deviceId
  );

  if (!runtime) {
    throw new Error(
      "OpenMeld could not find this computer in your account. Run `openmeld setup` or `openmeld service install`, then try again."
    );
  }

  return runtime;
}

async function syncCurrentComputerObservationIfAvailable(input: {
  currentDeviceApi: CurrentDeviceApi;
}): Promise<void> {
  const deviceId = await readCurrentLocalDeviceId();

  if (!deviceId) {
    return;
  }

  await syncCurrentComputerObservation({
    currentDeviceApi: input.currentDeviceApi,
    deviceId,
  });
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

function formatComputerMetadata(computer: LocalRuntimeComputer): string {
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
