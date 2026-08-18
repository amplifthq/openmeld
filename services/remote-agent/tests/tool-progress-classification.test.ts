import { describe, expect, it } from "vitest";
import { getRemoteAgentOpenMeldToolDefinitions } from "../agent-core/tools";
import { InMemoryDurableObjectStorage } from "./storage";

describe("Remote Agent tool progress classification", () => {
  it("tracks read-only observations without inferring the same rule for effects", () => {
    const definitions = getRemoteAgentOpenMeldToolDefinitions({
      coreWorker: {},
      storage: new InMemoryDurableObjectStorage(),
      submissionId: "submission_progress_classification",
    });
    const byName = new Map(
      definitions.map((definition) => [definition.name, definition])
    );

    expect(byName.get("openmeld_list_app_actions")?.progressTracking).toBe(
      "observation"
    );
    expect(byName.get("github_get_pull_request")?.progressTracking).toBe(
      "observation"
    );
    expect(byName.get("openmeld_execute_app_action")?.progressTracking).toBe(
      undefined
    );
    expect(byName.get("github_create_issue")?.progressTracking).toBe(undefined);
  });
});
