import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { z } from "zod/v4";
import {
  CodexSpaceDynamicToolInvocation,
  readCodexSpaceDynamicToolCarrier,
} from "../dist/transport/codex-space-action-dynamic-tools.js";

test("native carrier recovery reads only matching metadata from the controller session store", async () => {
  const home = await mkdtemp(join(tmpdir(), "codex-carrier-"));
  after(() => rm(home, { recursive: true, force: true }));
  const sessions = join(home, "sessions");
  await mkdir(sessions);
  const path = join(sessions, "rollout.jsonl");
  const thread = { id: "thread-1", threadSource: null, path };
  const payload = {
    id: thread.id,
    dynamic_tools: [{ type: "function", name: "openmeld_space_reply" }],
  };
  const writeHeader = (value) =>
    writeFile(
      path,
      `${JSON.stringify({ type: "session_meta", payload: value })}\nnot parsed as a conversation\n`
    );
  await writeHeader(payload);
  assert.equal(
    await readCodexSpaceDynamicToolCarrier({ thread, codexHome: home }),
    true
  );
  await writeHeader({ id: thread.id });
  assert.equal(
    await readCodexSpaceDynamicToolCarrier({ thread, codexHome: home }),
    false
  );
  await writeHeader({ ...payload, id: "another-thread" });
  await assert.rejects(
    readCodexSpaceDynamicToolCarrier({ thread, codexHome: home })
  );
  await writeHeader({ ...payload, dynamic_tools: "unknown-shape" });
  await assert.rejects(
    readCodexSpaceDynamicToolCarrier({ thread, codexHome: home })
  );
  await writeFile(path, " ".repeat(1024 * 1024 + 1));
  await assert.rejects(
    readCodexSpaceDynamicToolCarrier({ thread, codexHome: home })
  );
  await assert.rejects(
    readCodexSpaceDynamicToolCarrier({
      thread: { ...thread, path: home },
      codexHome: home,
    })
  );
});

test("native callbacks wait for a proven turn and expire on cancellation or a successor turn", async () => {
  let calls = 0;
  const cancellation = new AbortController();
  const invocation = new CodexSpaceDynamicToolInvocation(
    {
      deliveryOnly: true,
      tools: [
        {
          name: "reply",
          description: "Synthetic reply.",
          inputSchema: z.strictObject({ message: z.string() }),
        },
      ],
      call: () => {
        calls++;
        return Promise.resolve({
          content: [{ type: "text", text: "Synthetic saved receipt" }],
        });
      },
      close: () => undefined,
    },
    cancellation.signal
  );
  invocation.enabled = true;
  const request = {
    threadId: "thread-1",
    turnId: "turn-1",
    callId: "call-1",
    tool: "openmeld_space_reply",
    arguments: { message: "Public fixture" },
  };
  invocation.begin("thread-1");
  const early = invocation.call(request);
  assert.equal(calls, 0);
  invocation.accept("turn-1");
  assert.equal((await early).success, true);
  invocation.begin("thread-1");
  const stale = invocation.call(request);
  invocation.begin("successor-thread");
  assert.equal((await stale).success, false);
  invocation.accept("turn-2");
  cancellation.abort();
  assert.equal(
    (
      await invocation.call({
        ...request,
        threadId: "successor-thread",
        turnId: "turn-2",
      })
    ).success,
    false
  );
  invocation.fence();
  assert.equal((await invocation.call(request)).success, false);
  assert.equal(calls, 1);
});
