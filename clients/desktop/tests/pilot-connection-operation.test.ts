import {
  desktopComputerConnectionOperationSchema,
  desktopComputerOperationSchema,
} from "@openmeld/schemas";
import { afterEach, expect, it, vi } from "vitest";
import { initializeDesktopPilot } from "../src/main/pilot";
import { PILOT_IPC } from "../src/shared/pilot-bridge";

const boundary = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  review: vi.fn(),
  send: vi.fn(),
  confirm: vi.fn(),
  spawn: vi.fn(() => {
    throw new Error("Test executable unavailable");
  }),
}));
vi.mock("electron", () => ({
  app: { isPackaged: false },
  BrowserWindow: {},
  dialog: { showMessageBox: boundary.confirm },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      boundary.handlers.set(channel, handler),
  },
  protocol: { registerSchemesAsPrivileged: vi.fn() },
  session: { fromPartition: () => ({}) },
}));
vi.mock("node:child_process", async () => {
  const actual =
    await vi.importActual<typeof import("node:child_process")>(
      "node:child_process"
    );
  const { promisify } = await import("node:util");
  return {
    ...actual,
    execFile: Object.assign(vi.fn(), { [promisify.custom]: boundary.review }),
    spawn: boundary.spawn,
  };
});
vi.mock("../src/main/desktop-environment", () => ({
  resolveDesktopEnvPreset: () => "dev-local",
  resolveDesktopWebUrl: () => "http://lane.localhost:3000",
}));
vi.mock("../src/main/pilot-assets", () => ({ resolvePilotAssets: vi.fn() }));
vi.mock("../src/main/pilot-user-data", () => ({
  configurePilotUserData: vi.fn(),
  configureInstalledUserData: vi.fn(),
}));
vi.mock("../src/main/pilot-auth", () => ({
  createPilotAuth: () => ({
    session: async () => ({
      user: { id: "account-a", email: "a@example.com" },
    }),
    cookie: () => "",
    cloudRequest: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
  }),
}));
vi.mock("../src/main/pilot-space-stream", () => ({
  createPilotSpaceStreams: () => ({ closeAll: vi.fn() }),
}));
vi.mock("../src/main/pilot-notifications", () => ({
  createPilotNotifications: () => ({ clear: vi.fn() }),
}));
vi.mock("../src/main/pilot-transport", () => ({
  installPilotTransport: () => vi.fn(),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  boundary.review.mockReset();
  boundary.confirm.mockReset();
  boundary.handlers.clear();
});

function installPilot(authorize = vi.fn()) {
  vi.stubGlobal("__OPENMELD_DESKTOP_WEB_BUILD__", "a".repeat(64));
  vi.stubGlobal("__OPENMELD_DESKTOP_PRIVATE_PACKAGE__", false);
  vi.stubGlobal("__OPENMELD_DESKTOP_INSTALLED_TARGET__", null);
  vi.stubEnv("OPENMELD_DESKTOP_PILOT", "1");
  vi.stubEnv("OPENMELD_HOME", "/unused-pilot-operation-test");
  vi.stubEnv("OPENMELD_AUTH_URL", "http://lane.localhost:8788");
  vi.stubEnv("OPENMELD_GATEWAY_URL", "http://lane.localhost:8080");
  vi.stubEnv("OPENMELD_BIN", "/unused-pilot-operation-test/openmeld");
  const window = {
    webContents: { isDestroyed: () => false, send: boundary.send },
  } as unknown as NonNullable<
    ReturnType<Parameters<typeof initializeDesktopPilot>[0]>
  >;
  const pilot = initializeDesktopPilot(() => window, vi.fn());
  if (!pilot) {
    throw new Error("Expected the isolated pilot");
  }
  pilot.install(authorize);
  return pilot;
}

function reviewResponse() {
  return {
    stdout: JSON.stringify({
      protocol: "computer-connection-v1",
      previousSessionIdentity: "reviewed-session",
      account: { id: "account-a", email: "a@example.com" },
      existingConnection: { deviceId: "mac-a", runtimeLane: "dev-local" },
    }),
  };
}

function invoke(channel: string, request?: unknown) {
  const handler = boundary.handlers.get(channel);
  if (!handler) {
    throw new Error(`Missing handler: ${channel}`);
  }
  return handler({}, request);
}

it.each([
  false,
  true,
])("keeps the published operation identity through real progress and settlement (failure: %s)", async (fails) => {
  const review = Promise.withResolvers<{ stdout: string }>();
  boundary.review.mockReturnValue(review.promise);
  const pilot = installPilot();
  try {
    const result = boundary.handlers.get(PILOT_IPC.connectComputer)?.(
      {},
      { expectedAccount: "account-a" }
    );
    const pending = desktopComputerConnectionOperationSchema.parse(
      boundary.handlers.get(PILOT_IPC.connectionOperationCurrent)?.({})
    );
    expect(pending.status).toBe("pending");
    expect(pending.progress?.operationId).not.toBe(pending.operationId);
    if (fails) {
      const rejected = expect(result).rejects.toThrow("Review unavailable");
      review.reject(new Error("Review unavailable"));
      await rejected;
    } else {
      review.resolve({
        stdout: JSON.stringify({
          protocol: "computer-connection-v1",
          previousSessionIdentity: "reviewed-session",
          account: { id: "account-a", email: "a@example.com" },
          existingConnection: { deviceId: "mac-a", runtimeLane: "dev-local" },
        }),
      });
      await expect(result).resolves.toMatchObject({ status: "reused" });
    }
    const operations = boundary.send.mock.calls
      .filter(([channel]) => channel === PILOT_IPC.connectionOperation)
      .map(([, value]) =>
        desktopComputerConnectionOperationSchema.parse(value)
      );
    expect(operations[0]?.progress).toBeNull();
    expect(operations.at(-1)?.status).toBe("settled");
    expect(
      new Set(operations.map((operation) => operation.operationId)).size
    ).toBe(1);
    expect(operations.at(-1)?.operationId).toBe(pending.operationId);
    expect(operations.at(-1)?.progress?.operationId).toBe(
      pending.progress?.operationId
    );
  } finally {
    pilot.dispose();
  }
});

it.each([
  "legacy",
  "feedback",
])("retains confirmation and cancellation instead of old connect success (%s bridge)", async (bridge) => {
  boundary.review.mockResolvedValue(reviewResponse());
  const confirmation = Promise.withResolvers<{ response: number }>();
  boundary.confirm.mockReturnValue(confirmation.promise);
  const pilot = installPilot();
  try {
    await invoke(PILOT_IPC.connectComputer, { expectedAccount: "account-a" });
    const previous = desktopComputerConnectionOperationSchema.parse(
      invoke(PILOT_IPC.connectionOperationCurrent)
    );
    const channel =
      bridge === "legacy"
        ? PILOT_IPC.disconnectComputer
        : PILOT_IPC.disconnectComputerWithFeedback;
    const request = { expectedAccount: "account-a" };
    const result = invoke(channel, request);
    await vi.waitFor(() => {
      expect(invoke(PILOT_IPC.connectionOperationCurrent)).toMatchObject({
        kind: "disconnect",
        status: "pending",
        phase: "waiting_for_confirmation",
      });
    });
    await expect(invoke(PILOT_IPC.connectComputer, request)).rejects.toThrow(
      "already in progress"
    );
    await expect(invoke(channel, request)).rejects.toThrow(
      "already in progress"
    );
    confirmation.resolve({ response: 0 });
    await expect(result).resolves.toEqual(
      bridge === "legacy" ? false : { status: "cancelled" }
    );
    const settled = desktopComputerOperationSchema.parse(
      invoke(PILOT_IPC.connectionOperationCurrent)
    );
    expect(settled).toMatchObject({
      kind: "disconnect",
      status: "settled",
      result: { status: "cancelled" },
    });
    expect(settled.operationId).not.toBe(previous.operationId);
    expect(invoke(PILOT_IPC.connectionProgressCurrent)).toBeNull();
    expect(boundary.confirm).toHaveBeenCalledTimes(1);
    expect(boundary.spawn).not.toHaveBeenCalled();
  } finally {
    confirmation.resolve({ response: 0 });
    pilot.dispose();
  }
});

it("keeps accepted work exclusive and discards its late result after sign-out", async () => {
  const review = Promise.withResolvers<{ stdout: string }>();
  boundary.review.mockReturnValue(review.promise);
  const pilot = installPilot();
  try {
    const result = invoke(PILOT_IPC.connectComputer, {
      expectedAccount: "account-a",
    });
    await invoke(PILOT_IPC.signOut);
    expect(invoke(PILOT_IPC.connectionOperationCurrent)).toBeNull();
    await expect(
      invoke(PILOT_IPC.disconnectComputerWithFeedback, {
        expectedAccount: "account-a",
      })
    ).rejects.toThrow("already in progress");
    review.resolve(reviewResponse());
    await result;
    expect(invoke(PILOT_IPC.connectionOperationCurrent)).toBeNull();
    expect(invoke(PILOT_IPC.connectionProgressCurrent)).toBeNull();
    expect(
      boundary.send.mock.calls.filter(
        ([channel, value]) =>
          channel === PILOT_IPC.connectionOperation &&
          value.status === "settled"
      )
    ).toEqual([]);
  } finally {
    pilot.dispose();
  }
});

it.each([
  "legacy",
  "feedback",
])("never returns a truthy failure to a %s Disconnect caller", async (bridge) => {
  boundary.review.mockResolvedValue(reviewResponse());
  boundary.confirm.mockResolvedValue({ response: 1 });
  const pilot = installPilot();
  try {
    const result = invoke(
      bridge === "legacy"
        ? PILOT_IPC.disconnectComputer
        : PILOT_IPC.disconnectComputerWithFeedback,
      { expectedAccount: "account-a" }
    );
    if (bridge === "legacy") {
      await expect(result).rejects.toThrow("Disconnect was not started");
    } else {
      await expect(result).resolves.toMatchObject({
        status: "failed",
        code: "desktop.disconnect.start_failed",
        diagnosticId: expect.any(String),
      });
    }
    expect(invoke(PILOT_IPC.connectionOperationCurrent)).toMatchObject({
      kind: "disconnect",
      status: "settled",
      result: { status: "failed" },
    });
  } finally {
    pilot.dispose();
  }
});

it("authorizes the new feedback IPC before reading or changing the computer", async () => {
  const pilot = installPilot(
    vi.fn(() => {
      throw new Error("Untrusted renderer");
    })
  );
  try {
    await expect(
      invoke(PILOT_IPC.disconnectComputerWithFeedback, {
        expectedAccount: "account-a",
      })
    ).rejects.toThrow("Untrusted renderer");
    expect(boundary.review).not.toHaveBeenCalled();
    expect(boundary.confirm).not.toHaveBeenCalled();
    expect(boundary.send).not.toHaveBeenCalled();
  } finally {
    pilot.dispose();
  }
});
