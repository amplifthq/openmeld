type RegisteredDevice = {
  deviceId: string;
  connectedComputerId?: string | null;
  firstSeenAtMs: number;
  lastObservedAtMs: number | null;
};

/** Only enrollment identity can join device incarnations. Names are display data. */
export function groupPeopleComputerDevices<T extends RegisteredDevice>(
  devices: readonly T[]
): T[][] {
  const groups = new Map<string, T[]>();
  for (const device of devices) {
    const key = device.connectedComputerId
      ? `computer:${device.connectedComputerId}`
      : `device:${device.deviceId}`;
    const group = groups.get(key) ?? [];
    group.push(device);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** A display representative is not a routing preference or proof of connection. */
export function selectPeopleComputerDisplayDevice<T extends RegisteredDevice>(
  devices: readonly T[]
): T {
  const device = [...devices].sort(
    (left, right) =>
      (right.lastObservedAtMs ?? right.firstSeenAtMs) -
        (left.lastObservedAtMs ?? left.firstSeenAtMs) ||
      left.deviceId.localeCompare(right.deviceId)
  )[0];
  if (!device) {
    throw new Error("Computer identity has no registered device.");
  }
  return device;
}
