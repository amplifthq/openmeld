import assert from "node:assert/strict";
import test from "node:test";
import { createClaudeLiveInput } from "../dist/transport/claude-live-input.js";

const init = (version = "2.1.291") => ({
  type: "system",
  subtype: "init",
  session_id: "native-session",
  claude_code_version: version,
});
const request = {
  taskId: "task",
  inputId: "space-input",
  text: "Also check accessibility.",
};

test("Claude live input requires native consumption and the exact session", async () => {
  const input = createClaudeLiveInput("task", "Review the page.");
  const stream = input.prompt();
  assert.equal((await stream.next()).value.message.content, "Review the page.");
  input.observe(init());
  let settled = false;
  const receipt = input.steer(request).then((value) => {
    settled = true;
    return value;
  });
  const message = (await stream.next()).value;
  assert.equal(message.priority, "now");
  assert.equal(message.message.content, request.text);
  assert.notEqual(message.uuid, request.inputId);
  input.observe({ type: "result" });
  input.observe({ ...message, isReplay: true, session_id: "another-session" });
  await Promise.resolve();
  assert.equal(settled, false);
  input.observe({ ...message, isReplay: true, session_id: "native-session" });
  assert.deepEqual(await receipt, {
    status: "applied",
    taskId: "task",
    threadId: "native-session",
    turnId: message.uuid,
  });
  input.observe({ type: "result", user_message_uuid: message.uuid });
  assert.equal((await stream.next()).done, true);
  assert.equal(
    (await input.steer(request)).reasonCode,
    "execution_input.target_unavailable"
  );
});

test("Claude live input fails closed before init, on older CLIs, and after an unconfirmed result", async () => {
  const input = createClaudeLiveInput("task", "Review the page.");
  assert.equal(
    (await input.steer(request)).reasonCode,
    "execution_input.target_unavailable"
  );
  input.observe(init("2.1.289"));
  assert.equal(
    (await input.steer(request)).reasonCode,
    "execution_input.unsupported"
  );
  input.observe(init());
  assert.equal(
    (await input.steer({ ...request, taskId: "another-task" })).reasonCode,
    "execution_input.target_unavailable"
  );
  const receipt = input.steer(request);
  input.observe({ type: "result" });
  input.close();
  assert.equal((await receipt).status, "unconfirmed");
  assert.equal((await input.prompt().next()).done, true);
});
