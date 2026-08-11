import { describe, expect, it } from "vitest";
import { runUninstallFlow } from "../src/uninstall/flow";
import type { UninstallFlowDependencies } from "../src/uninstall/types";

describe("uninstall flow", () => {
  function createDependencies(events: string[]): UninstallFlowDependencies {
    return {
      resolveSkillsAction: () => {
        events.push("resolve-skills");
        return Promise.resolve({
          status: "resolved",
          value: "remove",
        });
      },
      resolveAuthTokenAction: () => {
        events.push("resolve-auth-tokens");
        return Promise.resolve({
          status: "resolved",
          value: "remove",
        });
      },
      confirmCurrentLane: () => {
        events.push("confirm-current-lane");
        return Promise.resolve({
          status: "resolved",
          value: true,
        });
      },
      confirmAllLanes: () => {
        events.push("confirm-all-lanes");
        return Promise.resolve({
          status: "resolved",
          value: true,
        });
      },
      resolveWarnings: () => {
        events.push("resolve-warnings");
        return Promise.resolve([
          {
            code: "shared_auth_tokens",
            message:
              "This sign-in is also used by another OpenMeld lane on this device.",
            affectedLanes: ["canary"],
          },
        ] as const);
      },
      removeSkills: () => {
        events.push("remove-skills");
        return Promise.resolve();
      },
      clearAuthTokens: () => {
        events.push("clear-auth-tokens");
        return Promise.resolve();
      },
      teardownService: ({ lane }) => {
        events.push(`teardown-service:${lane}`);
        return Promise.resolve({ removed: true });
      },
      removeHome: ({ lane }) => {
        events.push(`remove-home:${lane}`);
        return Promise.resolve({
          removed: true,
          homePath: `/tmp/${lane}`,
        });
      },
      resolveFinalCliRemoval: () => {
        events.push("resolve-final-cli-removal");
        return Promise.resolve({
          kind: "command",
          command: "pnpm openmeld:dev:remove",
          reason: "manual self-remove only",
        });
      },
    };
  }

  it("runs uninstall steps in the expected order for the current lane", async () => {
    const events: string[] = [];
    const result = await runUninstallFlow(
      {
        scope: {
          kind: "current-lane",
          lane: "dev-local",
        },
        interactive: true,
        yes: false,
        force: false,
      },
      createDependencies(events)
    );

    expect(result.status).toBe("completed");
    expect(events).toEqual([
      "resolve-skills",
      "resolve-auth-tokens",
      "resolve-warnings",
      "confirm-current-lane",
      "remove-skills",
      "clear-auth-tokens",
      "teardown-service:dev-local",
      "remove-home:dev-local",
      "resolve-final-cli-removal",
    ]);
  });

  it("iterates all lanes in a fixed order when all-lanes is selected", async () => {
    const events: string[] = [];
    const result = await runUninstallFlow(
      {
        scope: {
          kind: "all-lanes",
          lanes: ["prod", "dev-local", "canary"],
        },
        interactive: true,
        yes: false,
        force: false,
      },
      createDependencies(events)
    );

    expect(result.status).toBe("completed");
    expect(events).toEqual([
      "resolve-skills",
      "resolve-auth-tokens",
      "resolve-warnings",
      "confirm-all-lanes",
      "remove-skills",
      "clear-auth-tokens",
      "teardown-service:prod",
      "remove-home:prod",
      "teardown-service:dev-local",
      "remove-home:dev-local",
      "teardown-service:canary",
      "remove-home:canary",
      "resolve-final-cli-removal",
    ]);
  });

  it("returns cancelled when the skills selection is cancelled", async () => {
    const result = await runUninstallFlow(
      {
        scope: {
          kind: "current-lane",
          lane: "prod",
        },
        interactive: true,
        yes: false,
        force: false,
      },
      {
        ...createDependencies([]),
        resolveSkillsAction: async () => ({
          status: "cancelled",
        }),
      }
    );

    expect(result).toEqual({
      status: "cancelled",
      step: "skills",
    });
  });

  it("blocks the flow when destructive steps fail", async () => {
    const result = await runUninstallFlow(
      {
        scope: {
          kind: "current-lane",
          lane: "canary",
        },
        interactive: true,
        yes: false,
        force: false,
      },
      {
        ...createDependencies([]),
        removeHome: () => Promise.reject(new Error("home removal failed")),
      }
    );

    expect(result).toEqual({
      status: "blocked",
      step: "home",
      reason: "home removal failed",
      warnings: [
        {
          code: "shared_auth_tokens",
          message:
            "This sign-in is also used by another OpenMeld lane on this device.",
          affectedLanes: ["canary"],
        },
      ],
    });
  });
});
