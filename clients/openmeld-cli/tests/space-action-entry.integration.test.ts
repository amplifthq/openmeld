import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import {
  createDispatchSpaceActionContext,
  readDispatchSpaceActionRecord,
} from "../src/runtime/dispatch-space-action-context";

it("records a scoped reply without initializing unrelated global state", () => {
  const root = mkdtempSync(join(tmpdir(), "openmeld-action-entry-"));
  try {
    const { context, contextPath } = createDispatchSpaceActionContext({
      attemptId: "attempt-1",
      dispatchId: "dispatch-1",
      env: { OPENMELD_HOME: root },
      sendTargetReference: {
        status: "loaded",
        projection: [],
        referenceLines: [],
      },
      sourceEventId: "source-1",
      spaceContractSnapshot: {
        allowedActions: ["post_message"],
        publicationMode: "collaboration",
      },
      spaceId: "space-1",
      targetProfileId: "agt_test",
      taskId: "task-1",
    });
    // A file at the global layout directory makes initialization impossible.
    // The dispatch already has everything needed to record its reply.
    writeFileSync(join(root, "system"), "preserve this unrelated state");
    const result = spawnSync(
      process.execPath,
      [resolve("dist/openmeld.js"), "space", "action", "reply", "Scoped reply"],
      {
        encoding: "utf8",
        timeout: 15_000,
        env: {
          ...process.env,
          OPENMELD_HOME: root,
          OPENMELD_SPACE_ACTION_CONTEXT_PATH: contextPath,
        },
      }
    );
    expect(result.status, result.stderr).toBe(0);
    expect(readDispatchSpaceActionRecord({ context })).toMatchObject({
      status: "loaded",
      record: {
        action: {
          type: "post_message",
          messageEnvelope: { text: "Scoped reply" },
        },
      },
    });
    expect(readFileSync(join(root, "system"), "utf8")).toBe(
      "preserve this unrelated state"
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
