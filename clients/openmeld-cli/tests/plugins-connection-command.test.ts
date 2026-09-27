import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerPluginCommands } from "../src/plugins/registration";

const runPluginCommand = vi.hoisted(() => vi.fn());
vi.mock("../src/plugins/command", () => ({ runPluginCommand }));
function program() {
  const command = new Command()
    .exitOverride()
    .configureOutput({ writeErr: () => undefined });
  registerPluginCommands(command, {
    view: () => "agent",
    run: async (_tokens, execute) => await execute(),
  });
  return command;
}
beforeEach(() => runPluginCommand.mockReset());
describe("Local Agent Plugin setup command", () => {
  it.each([
    "choose",
    "personal",
    "shared",
  ])("preserves %s and delegates to the existing permission-bearing Plugin command", async (account) => {
    await program().parseAsync(
      [
        "plugins",
        "connect",
        "github",
        "--account",
        account,
        "--profile",
        "agent-profile",
      ],
      { from: "user" }
    );
    expect(runPluginCommand).toHaveBeenCalledWith({
      action: { operation: "connect", service: "github", account },
      profile: "agent-profile",
      view: "agent",
    });
  });
  it("defaults only unspecified setup to choose and never runs a provider action", async () => {
    await program().parseAsync(["plugins", "connect", "linear"], {
      from: "user",
    });
    expect(runPluginCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        action: { operation: "connect", service: "linear", account: "choose" },
      })
    );
    expect(runPluginCommand).toHaveBeenCalledOnce();
  });
  it("rejects an unknown service and invalid identity before invoking the server", async () => {
    await expect(
      program().parseAsync(["plugins", "connect", "not-a-service"], {
        from: "user",
      })
    ).rejects.toThrow();
    await expect(
      program().parseAsync(
        ["plugins", "connect", "github", "--account", "admin"],
        { from: "user" }
      )
    ).rejects.toThrow();
    expect(runPluginCommand).not.toHaveBeenCalled();
  });
});
