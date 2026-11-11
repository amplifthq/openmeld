import type { PluginActionRequestIntent } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import { readPluginIssuePreview } from "../src/connectors/plugin-issue-preview";
import type { CoreBindings } from "../src/lib/bindings";

const intent: PluginActionRequestIntent = {
  organizationId: "org",
  userId: "user",
  actorProfileId: "agent",
  operationId: "create",
  sourceRequestKey: null,
  service: "linear",
  actionId: "linear.create_linear_issue",
  effect: "write",
  connection: {
    service: "linear",
    connectionName: "linear-account",
    scope: "shared",
    ownerUserId: "user",
    ownerDisplayName: "Member",
  },
  accessRevision: 1,
  connectionUpdatedAtMs: 1,
  input: { teamId: "team-id", projectId: "project-id" },
  recovery: {
    input: {
      title: "Original title",
      description: "First line\n第二行",
      team_id: "team-id",
      project_id: "project-id",
      token: "secret-canary",
    },
  },
};

describe("Issue approval preview", () => {
  it.each([
    "unavailable",
    "mismatched",
    "unsafe",
  ])("keeps exact targets when names are %s and never copies unrelated input", async (scenario) => {
    // Shape from OpenConnector Linear run_query's GraphQL envelope, source
    // oomol-lab/open-connector@9da975b src/providers/linear/actions.ts.
    const pluginRuntime = vi.fn().mockResolvedValue(
      scenario === "unavailable"
        ? { status: "failed", error: "Unavailable", providerExecutionId: null }
        : {
            status: "completed",
            providerExecutionId: "read",
            outputSchema: {},
            data: {
              data: {
                team: {
                  id: scenario === "mismatched" ? "other-team" : "team-id",
                  name: scenario === "unsafe" ? "Fake\u202eteam" : "Other team",
                },
                project: { id: "project-id", name: "Reliability" },
              },
            },
          }
    );
    const preview = await readPluginIssuePreview(
      {
        OPENMELD_REMOTE_AGENT_WORKER: { pluginRuntime },
      } as unknown as CoreBindings,
      intent
    );
    expect(preview?.targets[0]).toEqual({
      label: "Team",
      id: "team-id",
      name: null,
    });
    expect(preview?.description).toBe("First line\n第二行");
    expect(preview?.additionalFieldCount).toBe(1);
    expect(JSON.stringify(preview)).not.toContain("secret-canary");
    expect(pluginRuntime.mock.calls[0]?.[0].input.variables).toEqual({
      teamId: "team-id",
      projectId: "project-id",
    });
  });
});
