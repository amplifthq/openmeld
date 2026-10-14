import assert from "node:assert/strict";
import test from "node:test";
import { createGrokBotAdapter, GrokBotClient } from "../dist/index.js";

// Wire fields captured from BDK 0.2.24 on 2026-10-14. Content and IDs
// are sanitized. Only send-message entries are provider-delivered replies.
const entry = (seq, kind, text) => ({
  seq,
  updatedSeq: seq,
  kind,
  text,
  createdAtMs: 1,
});
const page = (entries = [], busy = false) => ({
  entries,
  latestUpdatedSeq: entries.at(-1)?.updatedSeq ?? "2",
  turn: { idle: !busy, inFlight: busy, queued: 0 },
});
const request = {
  agentId: "grok-bot",
  agentControllerConversationId: "123",
  taskId: "task-1",
  sourceEventId: "event",
  spaceId: "space",
  prompt: "Say hello",
  runtimeContext: { providerRuntimeWorkingDirectory: "/tmp" },
};

function harness(pages) {
  const writes = [];
  const urls = [];
  const client = new GrokBotClient("test-key", (url, options) => {
    urls.push(new URL(url));
    if (options.method === "GET") {
      return Promise.resolve(Response.json(pages.shift() ?? page()));
    }
    const body = JSON.parse(options.body);
    writes.push({ path: new URL(url).pathname, body });
    return Promise.resolve(
      Response.json({
        messageId: body.messageId,
        delivery: "accepted_temporal",
      })
    );
  });
  const adapter = createGrokBotAdapter({
    createClient: () => Promise.resolve(client),
    wait: () => Promise.resolve(),
  });
  return { adapter, writes, urls };
}

test("publishes only newly delivered replies through the authorized writer", async () => {
  const { adapter, writes, urls } = harness([
    page([entry("1", "send-message", "PRIVATE_HISTORY")]),
    page(),
    page([entry("3", "message", "PRIVATE_THINKING")], true),
    page([entry("4", "send-message", "Hello")]),
    page(),
  ]);
  const replies = [];
  const result = await adapter.dispatch({
    ...request,
    spaceActionTools: {
      call: (name, args) => {
        replies.push({ name, args });
        return Promise.resolve({ content: [] });
      },
    },
  });
  assert.equal(result.status, "success");
  assert.ok(
    urls.every(
      (url) =>
        url.origin === "https://api.cursor.com" &&
        url.pathname.startsWith("/v0/grokbot/sessions/123/")
    )
  );
  assert.equal(result.output, "Hello");
  assert.deepEqual(replies, [{ name: "reply", args: { message: "Hello" } }]);
  assert.equal(writes.length, 1);
  assert.ok(writes[0].path.endsWith("/messages"));
});

test("busy, repair, and missing connection never send or create a Bot", async () => {
  for (const override of [
    {},
    { executionMode: "repair" },
    { agentControllerConversationId: null },
  ]) {
    const { adapter, writes } = harness([page([], true)]);
    const result = await adapter.dispatch({ ...request, ...override });
    assert.equal(result.status, "failed");
    assert.equal(writes.length, 0);
  }
});

test("stop waits for settlement and never publishes the interrupted reply", async () => {
  let release;
  let reached;
  const waiting = new Promise((resolve) => {
    reached = resolve;
  });
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  const { writes } = harness([]);
  let reads = 0;
  const client = new GrokBotClient("test-key", (url, options) => {
    if (options.method === "GET") {
      reads += 1;
      return Promise.resolve(Response.json(page([], reads === 2)));
    }
    writes.push(new URL(url).pathname);
    const body = JSON.parse(options.body);
    return Promise.resolve(
      Response.json({
        messageId: body.messageId,
        delivery: "accepted_temporal",
      })
    );
  });
  const adapter = createGrokBotAdapter({
    createClient: () => Promise.resolve(client),
    wait: async () => {
      reached();
      await blocked;
    },
  });
  let settled = false;
  const execution = adapter.dispatch(request).then((result) => {
    settled = true;
    return result;
  });
  await waiting;
  const stop = await adapter.cancel({ taskId: request.taskId });
  assert.equal(stop.accepted, true);
  assert.equal(settled, false);
  assert.ok(writes.some((path) => path.endsWith("/interrupt")));
  release();
  assert.equal((await execution).errorCode, "runtime.turn.cancelled");
});
