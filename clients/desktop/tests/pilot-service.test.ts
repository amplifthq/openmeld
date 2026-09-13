import { expect, it, vi } from "vitest";
import type { DesktopHandlers } from "../src/main/ipc-handlers";
import { readOnlyPilotServiceHandlers } from "../src/main/pilot-service";

it("keeps Service reads available but refuses local writes without atomic account binding", async () => {
  const startService = vi.fn();
  const getAuthStatus = vi.fn(() =>
    Promise.resolve({
      signedIn: true,
      accountId: "account-a",
      email: "member@example.com",
      problem: null,
    })
  );
  const base = { startService, getAuthStatus } as unknown as DesktopHandlers;
  const handlers = readOnlyPilotServiceHandlers(base);
  expect((await handlers.getAuthStatus()).accountId).toBe("account-a");
  await expect(handlers.startService()).rejects.toThrow(
    "Computer changes are unavailable"
  );
  await expect(handlers.signOutOnThisMac()).rejects.toThrow(
    "Computer changes are unavailable"
  );
  expect(startService).not.toHaveBeenCalled();
});
