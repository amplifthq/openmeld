import assert from "node:assert/strict";
import test from "node:test";

import { createLocalAdapterEntries } from "../dist/index.js";

test("local adapter factory installs Cursor with ACP only", () => {
  const entries = createLocalAdapterEntries({
    runtimeWorkdir: process.cwd(),
  });
  const cursorEntry = entries.find((entry) => entry.adapterId === "cursor");

  assert.ok(cursorEntry, "expected Cursor local adapter entry");
  assert.deepEqual(cursorEntry.transportModes, ["acp"]);
});

test("local OpenCode adapter forwards Stop Wake interrupt signals", async () => {
  const interruptSignals = [];
  const entries = createLocalAdapterEntries({
    runtimeWorkdir: process.cwd(),
    sendInterrupt: (signal) => {
      interruptSignals.push(signal);
      return Promise.resolve();
    },
  });
  const opencodeEntry = entries.find((entry) => entry.adapterId === "opencode");

  assert.ok(opencodeEntry, "expected OpenCode local adapter entry");
  const result = await opencodeEntry.adapter.interrupt({
    mode: "force",
    reason: "user stopped Wake",
    taskId: "task-opencode-stop",
  });

  assert.equal(result.accepted, true);
  assert.deepEqual(interruptSignals, [
    {
      mode: "force",
      reason: "user stopped Wake",
      taskId: "task-opencode-stop",
    },
  ]);
});
