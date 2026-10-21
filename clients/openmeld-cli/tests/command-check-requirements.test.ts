import { describe, expect, it } from "vitest";
import {
  COMMAND_CHECK_REQUIREMENTS,
  getCommandCheckRequirements,
} from "../src/command-entry-checks/command-check-requirements";
import {
  COMMAND_ENTRY_ROUTE_KEYS,
  resolveCommandEntryNameFromRoute,
} from "../src/command-entry-checks/command-entry-name";

describe("command check requirements", () => {
  it("defines requirements for every canonical command entry used by the route map", () => {
    const routeEntryNames = [
      ...new Set(
        COMMAND_ENTRY_ROUTE_KEYS.map((route) => {
          const entryName = resolveCommandEntryNameFromRoute(route);
          expect(entryName).not.toBeNull();
          return entryName;
        })
      ),
    ].sort();
    const requirementEntryNames = Object.keys(
      COMMAND_CHECK_REQUIREMENTS
    ).sort();

    expect(requirementEntryNames).toEqual(routeEntryNames);
  });

  it("requires sign-in before offering a plugin connection", () => {
    expect(getCommandCheckRequirements("plugins.connect")).toMatchObject({
      signIn: { mode: "required", stage: "before-entry" },
    });
  });

  it("requires sign-in and a selected profile for interactive space commands", () => {
    expect(getCommandCheckRequirements("space.create")).toMatchObject({
      cliUpdate: { mode: "optional", stage: "before-entry" },
      localRuntimeState: { mode: "skip", stage: "before-entry" },
      signIn: { mode: "required", stage: "before-entry" },
      selectedProfile: { mode: "confirm", stage: "after-sign-in" },
      service: { mode: "skip", stage: "after-sign-in" },
    });
    expect(getCommandCheckRequirements("space.join")).toMatchObject({
      cliUpdate: { mode: "optional", stage: "before-entry" },
      localRuntimeState: { mode: "auto-fix", stage: "before-entry" },
      signIn: { mode: "required", stage: "before-entry" },
      selectedProfile: { mode: "confirm", stage: "after-sign-in" },
      service: { mode: "skip", stage: "after-sign-in" },
    });
    expect(getCommandCheckRequirements("space.watch")).toMatchObject({
      localRuntimeState: { mode: "auto-fix", stage: "before-entry" },
      signIn: { mode: "required", stage: "before-entry" },
      selectedProfile: { mode: "confirm", stage: "after-sign-in" },
      service: { mode: "skip", stage: "after-sign-in" },
    });
    expect(getCommandCheckRequirements("space.send")).toMatchObject({
      selectedProfile: { mode: "confirm", stage: "after-sign-in" },
    });
    expect(getCommandCheckRequirements("space.password")).toMatchObject({
      selectedProfile: { mode: "confirm", stage: "after-sign-in" },
    });
    expect(getCommandCheckRequirements("space.guide")).toMatchObject({
      localRuntimeState: { mode: "auto-fix", stage: "before-entry" },
      selectedProfile: { mode: "confirm", stage: "after-sign-in" },
    });
    expect(getCommandCheckRequirements("space.guide.set")).toMatchObject({
      localRuntimeState: { mode: "auto-fix", stage: "before-entry" },
      selectedProfile: { mode: "confirm", stage: "after-sign-in" },
    });
    expect(getCommandCheckRequirements("space.guide.clear")).toMatchObject({
      localRuntimeState: { mode: "auto-fix", stage: "before-entry" },
      selectedProfile: { mode: "confirm", stage: "after-sign-in" },
    });
  });

  it("keeps doctor status-only while whoami renders its own state", () => {
    expect(getCommandCheckRequirements("doctor")).toMatchObject({
      cliUpdate: { mode: "optional", stage: "before-entry" },
      signIn: { mode: "optional", stage: "before-entry" },
      localRuntimeState: { mode: "skip", stage: "before-entry" },
      service: { mode: "status-only", stage: "status-only" },
    });
    expect(getCommandCheckRequirements("whoami")).toMatchObject({
      cliUpdate: { mode: "optional", stage: "before-entry" },
      localRuntimeState: { mode: "skip", stage: "before-entry" },
      signIn: { mode: "skip", stage: "before-entry" },
      selectedProfile: { mode: "skip", stage: "after-sign-in" },
    });
  });

  it("uses shared organization context checks without requiring a local profile", () => {
    for (const entryName of [
      "member_agents.list",
      "member_agents.show",
      "member_agents.sessions.list",
      "member_agents.sessions.rename",
      "member_agents.sessions.archive",
      "member_agents.sessions.restore",
      "member_agents.sessions.delete",
      "routines.list",
      "routines.create",
      "routines.show",
      "routines.update",
      "routines.pause",
      "routines.resume",
      "routines.delete",
      "routines.runs",
      "projects.list",
      "projects.create",
      "projects.update",
      "projects.archive",
      "projects.bind",
    ] as const) {
      expect(getCommandCheckRequirements(entryName)).toMatchObject({
        cliUpdate: { mode: "optional", stage: "before-entry" },
        localRuntimeState: { mode: "skip", stage: "before-entry" },
        signIn: { mode: "required", stage: "before-entry" },
        selectedProfile: { mode: "skip", stage: "after-sign-in" },
        service: { mode: "skip", stage: "after-sign-in" },
      });
    }
    expect(getCommandCheckRequirements("projects.unbind")).toMatchObject({
      cliUpdate: { mode: "skip", stage: "before-entry" },
      disclaimer: { mode: "skip", stage: "before-entry" },
      signIn: { mode: "skip", stage: "before-entry" },
    });
  });

  it("keeps status-only flows free of local auto-fix while space local-state readers stay covered", () => {
    expect(getCommandCheckRequirements("space.access")).toMatchObject({
      disclaimer: { mode: "skip", stage: "before-entry" },
      cliUpdate: { mode: "optional", stage: "before-entry" },
      localRuntimeState: { mode: "skip", stage: "before-entry" },
      signIn: { mode: "skip", stage: "before-entry" },
      selectedProfile: { mode: "skip", stage: "after-sign-in" },
      service: { mode: "skip", stage: "after-sign-in" },
    });
    for (const entryName of [
      "space.add-me",
      "space.add-agents",
      "space.add-human-profiles",
      "space.add-members",
    ] as const) {
      expect(getCommandCheckRequirements(entryName)).toMatchObject({
        localRuntimeState: { mode: "skip", stage: "before-entry" },
        signIn: { mode: "required", stage: "before-entry" },
        selectedProfile: { mode: "confirm", stage: "after-sign-in" },
      });
    }
    expect(getCommandCheckRequirements("space.history")).toMatchObject({
      localRuntimeState: { mode: "auto-fix", stage: "before-entry" },
      signIn: { mode: "required", stage: "before-entry" },
      selectedProfile: { mode: "confirm", stage: "after-sign-in" },
    });
    expect(getCommandCheckRequirements("space.board")).toMatchObject({
      localRuntimeState: { mode: "auto-fix", stage: "before-entry" },
      signIn: { mode: "required", stage: "before-entry" },
      selectedProfile: { mode: "confirm", stage: "after-sign-in" },
    });
    expect(getCommandCheckRequirements("space.list")).toMatchObject({
      localRuntimeState: { mode: "auto-fix", stage: "before-entry" },
      signIn: { mode: "required", stage: "before-entry" },
      selectedProfile: { mode: "confirm", stage: "after-sign-in" },
    });
    expect(getCommandCheckRequirements("service.trace")).toMatchObject({
      localRuntimeState: { mode: "skip", stage: "before-entry" },
      signIn: { mode: "required", stage: "before-entry" },
      selectedProfile: { mode: "required", stage: "after-sign-in" },
      service: { mode: "skip", stage: "after-sign-in" },
    });
    expect(getCommandCheckRequirements("profile.show")).toMatchObject({
      cliUpdate: { mode: "optional", stage: "before-entry" },
      localRuntimeState: { mode: "auto-fix", stage: "before-entry" },
      signIn: { mode: "required", stage: "before-entry" },
      selectedProfile: { mode: "skip", stage: "after-sign-in" },
    });
  });

  it("keeps computer list account-scoped and current/rename local-computer scoped", () => {
    expect(getCommandCheckRequirements("computer.list")).toMatchObject({
      cliUpdate: { mode: "optional", stage: "before-entry" },
      localRuntimeState: { mode: "skip", stage: "before-entry" },
      signIn: { mode: "required", stage: "before-entry" },
      selectedProfile: { mode: "skip", stage: "after-sign-in" },
      service: { mode: "skip", stage: "after-sign-in" },
    });
    expect(getCommandCheckRequirements("computer.current")).toMatchObject({
      cliUpdate: { mode: "optional", stage: "before-entry" },
      localRuntimeState: { mode: "auto-fix", stage: "before-entry" },
      signIn: { mode: "required", stage: "before-entry" },
      selectedProfile: { mode: "skip", stage: "after-sign-in" },
      service: { mode: "skip", stage: "after-sign-in" },
    });
    expect(getCommandCheckRequirements("computer.rename")).toMatchObject({
      cliUpdate: { mode: "optional", stage: "before-entry" },
      localRuntimeState: { mode: "auto-fix", stage: "before-entry" },
      signIn: { mode: "required", stage: "before-entry" },
      selectedProfile: { mode: "skip", stage: "after-sign-in" },
      service: { mode: "skip", stage: "after-sign-in" },
    });
  });

  it("keeps service autostart local and free of service lifecycle mutation checks", () => {
    expect(getCommandCheckRequirements("service.autostart")).toMatchObject({
      cliUpdate: { mode: "optional", stage: "before-entry" },
      localRuntimeState: { mode: "skip", stage: "before-entry" },
      signIn: { mode: "skip", stage: "before-entry" },
      selectedProfile: { mode: "skip", stage: "after-sign-in" },
      service: { mode: "skip", stage: "after-sign-in" },
    });
  });

  it("keeps start focused on true pre-entry checks", () => {
    expect(getCommandCheckRequirements("root")).toMatchObject({
      cliUpdate: { mode: "optional", stage: "before-entry" },
      localRuntimeState: { mode: "skip", stage: "before-entry" },
      signIn: { mode: "skip", stage: "before-entry" },
      selectedProfile: { mode: "skip", stage: "after-sign-in" },
      service: { mode: "skip", stage: "after-sign-in" },
    });
    expect(getCommandCheckRequirements("start")).toMatchObject({
      cliUpdate: { mode: "optional", stage: "before-entry" },
      localRuntimeState: { mode: "auto-fix", stage: "before-entry" },
      skills: { mode: "skip", stage: "status-only" },
      service: { mode: "skip", stage: "after-sign-in" },
    });
  });

  it("keeps feedback available before setup or sign-in", () => {
    expect(getCommandCheckRequirements("feedback")).toMatchObject({
      disclaimer: { mode: "skip", stage: "before-entry" },
      cliUpdate: { mode: "optional", stage: "before-entry" },
      localRuntimeState: { mode: "skip", stage: "before-entry" },
      signIn: { mode: "skip", stage: "before-entry" },
      selectedProfile: { mode: "skip", stage: "after-sign-in" },
      service: { mode: "skip", stage: "after-sign-in" },
      skills: { mode: "skip", stage: "status-only" },
    });
  });

  it("keeps uninstall free of entry blockers", () => {
    expect(getCommandCheckRequirements("uninstall")).toMatchObject({
      cliUpdate: { mode: "skip", stage: "before-entry" },
      signIn: { mode: "skip", stage: "before-entry" },
      localRuntimeState: { mode: "skip", stage: "before-entry" },
      selectedProfile: { mode: "skip", stage: "after-sign-in" },
      service: { mode: "skip", stage: "after-sign-in" },
    });
  });

  it("runs the shared disclaimer gate for real OpenMeld commands but skips passive top-level entries", () => {
    expect(getCommandCheckRequirements("root")).toMatchObject({
      disclaimer: { mode: "skip", stage: "before-entry" },
    });
    expect(getCommandCheckRequirements("view")).toMatchObject({
      disclaimer: { mode: "skip", stage: "before-entry" },
    });
    expect(getCommandCheckRequirements("start")).toMatchObject({
      disclaimer: { mode: "required", stage: "before-entry" },
    });
    expect(getCommandCheckRequirements("auth.login")).toMatchObject({
      disclaimer: { mode: "required", stage: "before-entry" },
    });
    expect(getCommandCheckRequirements("space.join")).toMatchObject({
      disclaimer: { mode: "required", stage: "before-entry" },
    });
    expect(getCommandCheckRequirements("service.run")).toMatchObject({
      disclaimer: { mode: "required", stage: "before-entry" },
    });
    expect(getCommandCheckRequirements("whoami")).toMatchObject({
      disclaimer: { mode: "required", stage: "before-entry" },
    });
  });

  it("adds local runtime repair to profile, agents, and service run flows", () => {
    expect(getCommandCheckRequirements("space.menu")).toMatchObject({
      localRuntimeState: { mode: "auto-fix", stage: "before-entry" },
      signIn: { mode: "required", stage: "before-entry" },
      selectedProfile: { mode: "confirm", stage: "after-sign-in" },
    });
    for (const entryName of [
      "space.add-me",
      "space.add-agents",
      "space.add-human-profiles",
      "space.add-members",
    ] as const) {
      expect(getCommandCheckRequirements(entryName)).toMatchObject({
        localRuntimeState: { mode: "skip", stage: "before-entry" },
        signIn: { mode: "required", stage: "before-entry" },
        selectedProfile: { mode: "confirm", stage: "after-sign-in" },
      });
    }
    expect(getCommandCheckRequirements("space.remove-members")).toMatchObject({
      localRuntimeState: { mode: "auto-fix", stage: "before-entry" },
      signIn: { mode: "required", stage: "before-entry" },
      selectedProfile: { mode: "confirm", stage: "after-sign-in" },
    });
    expect(getCommandCheckRequirements("space.leave")).toMatchObject({
      localRuntimeState: { mode: "auto-fix", stage: "before-entry" },
      signIn: { mode: "required", stage: "before-entry" },
      selectedProfile: { mode: "confirm", stage: "after-sign-in" },
    });
    expect(getCommandCheckRequirements("profile.menu")).toMatchObject({
      localRuntimeState: { mode: "auto-fix", stage: "before-entry" },
      signIn: { mode: "required", stage: "before-entry" },
    });
    expect(getCommandCheckRequirements("agents.menu")).toMatchObject({
      localRuntimeState: { mode: "auto-fix", stage: "before-entry" },
      signIn: { mode: "skip", stage: "before-entry" },
    });
    expect(getCommandCheckRequirements("setup")).toMatchObject({
      cliUpdate: { mode: "skip", stage: "before-entry" },
      localRuntimeState: { mode: "auto-fix", stage: "before-entry" },
      signIn: { mode: "skip", stage: "before-entry" },
      service: { mode: "skip", stage: "after-sign-in" },
    });
    expect(getCommandCheckRequirements("service.run")).toMatchObject({
      localRuntimeState: { mode: "auto-fix", stage: "before-entry" },
      signIn: { mode: "required", stage: "before-entry" },
      selectedProfile: { mode: "skip", stage: "after-sign-in" },
      service: { mode: "skip", stage: "after-sign-in" },
    });
    expect(getCommandCheckRequirements("service.interrupt")).toMatchObject({
      cliUpdate: { mode: "optional", stage: "before-entry" },
      localRuntimeState: { mode: "auto-fix", stage: "before-entry" },
      signIn: { mode: "skip", stage: "before-entry" },
      selectedProfile: { mode: "skip", stage: "after-sign-in" },
      service: { mode: "skip", stage: "after-sign-in" },
    });
    expect(getCommandCheckRequirements("service.cancel")).toMatchObject({
      cliUpdate: { mode: "optional", stage: "before-entry" },
      localRuntimeState: { mode: "auto-fix", stage: "before-entry" },
      signIn: { mode: "skip", stage: "before-entry" },
      selectedProfile: { mode: "skip", stage: "after-sign-in" },
      service: { mode: "skip", stage: "after-sign-in" },
    });
  });
});
