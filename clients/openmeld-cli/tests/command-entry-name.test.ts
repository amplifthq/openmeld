import { describe, expect, it } from "vitest";
import {
  COMMAND_ENTRY_ROUTE_KEYS,
  resolveCommandEntryNameFromRoute,
  resolveCommandEntryNameFromTokens,
} from "../src/command-entry-checks/command-entry-name";

describe("command entry name", () => {
  it("maps every declared route key to a canonical command entry name", () => {
    for (const route of COMMAND_ENTRY_ROUTE_KEYS) {
      expect(resolveCommandEntryNameFromRoute(route)).not.toBeNull();
    }
  });

  it("normalizes route tokens for aliases and subcommands", () => {
    expect(resolveCommandEntryNameFromTokens([])).toBe("root");
    expect(resolveCommandEntryNameFromTokens(["space", "join"])).toBe(
      "space.join"
    );
    expect(resolveCommandEntryNameFromTokens([" space ", "join "])).toBe(
      "space.join"
    );
    expect(resolveCommandEntryNameFromTokens(["profiles"])).toBe(
      "profile.menu"
    );
    expect(resolveCommandEntryNameFromTokens(["login"])).toBe("auth.login");
    expect(resolveCommandEntryNameFromTokens(["center-agent", "ask"])).toBe(
      "center_agent.ask"
    );
    expect(resolveCommandEntryNameFromTokens(["invite"])).toBeNull();
    expect(resolveCommandEntryNameFromTokens(["daemon", "run"])).toBe(
      "service.run"
    );
    expect(resolveCommandEntryNameFromTokens(["daemon", "interrupt"])).toBe(
      "service.interrupt"
    );
    expect(resolveCommandEntryNameFromTokens(["service", "cancel"])).toBe(
      "service.cancel"
    );
    expect(resolveCommandEntryNameFromTokens(["service", "trace"])).toBe(
      "service.trace"
    );
    expect(
      resolveCommandEntryNameFromTokens(["service", "autostart", "enable"])
    ).toBe("service.autostart");
    expect(
      resolveCommandEntryNameFromTokens(["service", "autostart", "disable"])
    ).toBe("service.autostart");
    expect(resolveCommandEntryNameFromTokens(["spaces", "join"])).toBe(
      "space.join"
    );
    expect(resolveCommandEntryNameFromTokens(["space", "board"])).toBe(
      "space.board"
    );
    expect(resolveCommandEntryNameFromTokens(["spaces", "board"])).toBe(
      "space.board"
    );
    expect(resolveCommandEntryNameFromTokens(["space", "members"])).toBe(
      "space.members"
    );
    expect(resolveCommandEntryNameFromTokens(["spaces", "members"])).toBe(
      "space.members"
    );
    expect(resolveCommandEntryNameFromTokens(["space", "wake-progress"])).toBe(
      "space.wake_progress"
    );
    expect(resolveCommandEntryNameFromTokens(["space", "wake-stop"])).toBe(
      "space.wake_stop"
    );
    expect(
      resolveCommandEntryNameFromTokens(["space", "list", "--organization"])
    ).toBe("space.list.organization");
    expect(
      resolveCommandEntryNameFromTokens(["space", "join", "--self-serve"])
    ).toBe("space.join.self_serve");
    expect(resolveCommandEntryNameFromTokens(["space", "add-me"])).toBe(
      "space.add-me"
    );
    expect(resolveCommandEntryNameFromTokens(["space", "add-agents"])).toBe(
      "space.add-agents"
    );
    expect(
      resolveCommandEntryNameFromTokens(["space", "add-human-profiles"])
    ).toBe("space.add-human-profiles");
    expect(resolveCommandEntryNameFromTokens(["space", "add-profiles"])).toBe(
      "space.add-members"
    );
    expect(resolveCommandEntryNameFromTokens(["space", "remove-members"])).toBe(
      "space.remove-members"
    );
    expect(resolveCommandEntryNameFromTokens(["space", "leave"])).toBe(
      "space.leave"
    );
    for (const command of [
      "list",
      "read",
      "upload",
      "write",
      "download",
      "mkdir",
      "rename",
      "move",
      "trash",
      "history",
      "restore",
      "restore-version",
    ] as const) {
      expect(
        resolveCommandEntryNameFromTokens(["space", "files", command])
      ).toBe(`space.files.${command}`);
    }
    expect(resolveCommandEntryNameFromTokens(["send"])).toBe("space.send");
    expect(resolveCommandEntryNameFromTokens(["tail"])).toBe("space.history");
    expect(resolveCommandEntryNameFromTokens(["agents", "custom", "add"])).toBe(
      "agents.custom.add"
    );
    expect(resolveCommandEntryNameFromTokens(["agents", "prepare"])).toBeNull();
    expect(resolveCommandEntryNameFromTokens(["setup"])).toBe("setup");
    expect(resolveCommandEntryNameFromTokens(["feedback"])).toBe("feedback");
    expect(resolveCommandEntryNameFromTokens(["org", "directory"])).toBe(
      "organization.directory"
    );
    expect(resolveCommandEntryNameFromTokens(["org", "computers"])).toBe(
      "organization.computers"
    );
    expect(
      resolveCommandEntryNameFromTokens(["org", "invite-link", "create"])
    ).toBe("organization.invite_link.create");
    expect(resolveCommandEntryNameFromTokens(["computer", "list"])).toBe(
      "computer.list"
    );
    expect(resolveCommandEntryNameFromTokens(["computer", "current"])).toBe(
      "computer.current"
    );
    expect(resolveCommandEntryNameFromTokens(["uninstall"])).toBe("uninstall");
    expect(resolveCommandEntryNameFromTokens(["profile", "ready"])).toBeNull();
    expect(resolveCommandEntryNameFromTokens(["profile", "show"])).toBe(
      "profile.show"
    );
    expect(
      resolveCommandEntryNameFromTokens(["profiles", "current-session"])
    ).toBe("profile.current-session");
    expect(
      resolveCommandEntryNameFromTokens(["profile", "requests", "list"])
    ).toBe("profile.requests.list");
    expect(
      resolveCommandEntryNameFromTokens([
        "profile",
        "requests",
        "preferences",
        "set",
      ])
    ).toBe("profile.requests.preferences.set");
    expect(resolveCommandEntryNameFromTokens(["skills", "ensure"])).toBe(
      "skills.ensure"
    );
    for (const command of [
      "list",
      "create",
      "show",
      "update",
      "pause",
      "resume",
      "delete",
      "runs",
    ] as const) {
      expect(resolveCommandEntryNameFromTokens(["routines", command])).toBe(
        `routines.${command}`
      );
    }
    for (const command of [
      "list",
      "create",
      "update",
      "archive",
      "bind",
      "unbind",
    ] as const) {
      expect(resolveCommandEntryNameFromTokens(["projects", command])).toBe(
        `projects.${command}`
      );
    }
    for (const command of ["list", "remove", "set-default"] as const) {
      expect(
        resolveCommandEntryNameFromTokens(["projects", "connections", command])
      ).toBe(`projects.connections.${command}`);
    }
  });

  it("returns null for unknown commands", () => {
    expect(resolveCommandEntryNameFromTokens(["unknown"])).toBeNull();
  });
});
