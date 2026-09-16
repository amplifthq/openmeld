import { serviceControlCapabilitiesSchema } from "@openmeld/schemas";
import { expect, it, vi } from "vitest";
import type { ExecFileFn } from "../src/main/cli/driver";
import type { DesktopHandlers } from "../src/main/ipc-handlers";
import { createPilotServiceHandlers } from "../src/main/pilot-service";

function fixture(
  input: { supported?: boolean; changeAccountDuringProbe?: boolean } = {}
) {
  let account = "account-a";
  const mutations: { args: readonly string[]; timeout: number | undefined }[] =
    [];
  const exec: ExecFileFn = (_file, args, options, callback) => {
    if (args[1] === "control-capabilities") {
      const capabilities = serviceControlCapabilitiesSchema.parse({
        deviceId: "computer-a",
        start: input.supported !== false,
        stop: input.supported !== false,
      });
      if (input.changeAccountDuringProbe) {
        account = "account-b";
      }
      callback(
        null,
        JSON.stringify({
          schemaVersion: 1,
          type: "service.control_capabilities",
          ...capabilities,
        }),
        ""
      );
    } else {
      mutations.push({ args, timeout: options.timeout });
      callback(
        null,
        JSON.stringify({ schemaVersion: 1, type: "daemon.status" }),
        ""
      );
    }
  };
  const base = {
    getServiceStatus: vi.fn(async () => ({
      lifecycle: "stopped",
      problem: null,
    })),
  } as unknown as DesktopHandlers;
  const handlers = createPilotServiceHandlers(
    base,
    {
      session: async () => ({
        user: { id: account, email: "member@example.com", name: "Member" },
      }),
    },
    { exec, openMeldBin: "/isolated/bin/openmeld" }
  );
  return { handlers, mutations };
}

it.each([
  "start",
  "stop",
] as const)("passes immutable account intent to guarded %s without a drain timeout", async (operation) => {
  const { handlers, mutations } = fixture();
  await handlers[operation === "start" ? "startService" : "stopService"](
    "account-a"
  );
  expect(mutations).toEqual([
    {
      args: ["service", operation, "--expected-account", "account-a", "--json"],
      timeout: 0,
    },
  ]);
});

it.each([
  { expectedAccount: undefined },
  { expectedAccount: "account-b" },
  { expectedAccount: "account-a", supported: false },
  { expectedAccount: "account-a", changeAccountDuringProbe: true },
])("refuses missing, mismatched, changed, or unsupported intent without mutations: %j", async (input) => {
  const { handlers, mutations } = fixture(input);
  await expect(handlers.startService(input.expectedAccount)).rejects.toThrow();
  expect(mutations).toEqual([]);
});

it("keeps all other pilot local mutations refused", async () => {
  const { handlers, mutations } = fixture();
  for (const action of [
    handlers.signIn,
    handlers.signOutOnThisMac,
    handlers.installCli,
    handlers.upgradeCli,
    handlers.setupComputer,
    handlers.installService,
    handlers.updateService,
    () => handlers.setServiceAutoStart(true),
    () => handlers.setAgentEnabled("agent", true),
  ]) {
    await expect(action()).rejects.toThrow("Computer changes are unavailable");
  }
  expect(mutations).toEqual([]);
});
