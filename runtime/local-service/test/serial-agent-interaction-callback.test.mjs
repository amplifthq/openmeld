import assert from "node:assert/strict";
import test from "node:test";
import { createSerialAgentInteractionCallback } from "../dist/index.js";

const createPermissionRequest = (title) => ({
  kind: "permission",
  options: [
    {
      intent: "allow_once",
      label: "Allow once",
      optionId: "allow-once",
    },
  ],
  subject: {
    command: "pnpm test",
    type: "command",
  },
  title,
});

const waitForMicrotasks = async () =>
  await new Promise((resolve) => setImmediate(resolve));

test("serial interaction callback waits for the active response before presenting the next request", async () => {
  const started = [];
  const resolveByTitle = new Map();
  const callback = createSerialAgentInteractionCallback(
    (request) =>
      new Promise((resolve) => {
        started.push(request.title);
        resolveByTitle.set(request.title, resolve);
      })
  );

  const first = callback(createPermissionRequest("First"));
  const second = callback(createPermissionRequest("Second"));
  await waitForMicrotasks();
  assert.deepEqual(started, ["First"]);

  resolveByTitle.get("First")({
    kind: "permission",
    optionId: "allow-once",
  });
  await first;
  await waitForMicrotasks();
  assert.deepEqual(started, ["First", "Second"]);

  resolveByTitle.get("Second")({
    kind: "permission",
    optionId: "allow-once",
  });
  await second;
});
