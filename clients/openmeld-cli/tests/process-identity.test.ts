import { readWindowsProcessStartFileTime } from "@openmeld/adapter-core/windows-system";
import { afterEach, expect, it, vi } from "vitest";
import {
  isProcessIdentityAlive,
  readProcessStartIdentity,
} from "../src/system/process-identity";

vi.mock("@openmeld/adapter-core/windows-system", () => ({
  readWindowsProcessStartFileTime: vi.fn(() => "134027136001234567"),
}));

afterEach(() => vi.restoreAllMocks());

it("uses the opened Windows process's FILETIME, not ps or an estimated start time", () => {
  expect(readProcessStartIdentity(process.pid, "win32")).toBe(
    "win32:134027136001234567"
  );
  expect(readWindowsProcessStartFileTime).toHaveBeenCalledWith(process.pid);
});

it("distinguishes a reused Windows PID from the recorded owner", () => {
  expect(
    isProcessIdentityAlive(
      {
        ownerPid: process.pid,
        ownerProcessStartedAt: "win32:134027136001234566",
      },
      "win32"
    )
  ).toBe(false);
  expect(
    isProcessIdentityAlive(
      {
        ownerPid: process.pid,
        ownerProcessStartedAt: "win32:134027136001234567",
      },
      "win32"
    )
  ).toBe(true);
});

it("retains the fence when a live process identity is unavailable or from an older format", () => {
  vi.mocked(readWindowsProcessStartFileTime).mockReturnValueOnce(null);
  expect(readProcessStartIdentity(process.pid, "win32")).toBeNull();
  vi.mocked(readWindowsProcessStartFileTime).mockReturnValueOnce(null);
  expect(
    isProcessIdentityAlive(
      {
        ownerPid: process.pid,
        ownerProcessStartedAt: "win32:134027136001234567",
      },
      "win32"
    )
  ).toBe(true);
  expect(
    isProcessIdentityAlive(
      { ownerPid: process.pid, ownerProcessStartedAt: "fallback:old-owner" },
      "win32"
    )
  ).toBe(true);
});

it("rejects invalid PIDs before consulting the Windows process reader", () => {
  vi.mocked(readWindowsProcessStartFileTime).mockClear();
  for (const pid of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    expect(readProcessStartIdentity(pid, "win32")).toBeNull();
  }
  expect(readWindowsProcessStartFileTime).not.toHaveBeenCalled();
});
