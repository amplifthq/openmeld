import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { test } from "node:test";

// Exercise the installed vendor stream implementation. These two internals are
// exported only inside this isolated module, because capnweb has no public clock
// injection for its stream adapter. No production code or algorithm is replaced.
const requireComputer = createRequire(
  import.meta.resolve("@cloudflare/computer")
);
const source = await readFile(
  requireComputer.resolve("capnweb").replace(/\.cjs$/u, ".js"),
  "utf8"
);
const clock = { value: 100 };
globalThis.__computerFlowTestClock = clock;
const { createWritableStreamFromHook } = await import(
  `data:text/javascript;base64,${Buffer.from(
    `const performance = { now: () => globalThis.__computerFlowTestClock.value };\n${source}\nexport { createWritableStreamFromHook };`
  ).toString("base64")}`
);
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("equal-time ACKs release blocked writes, preserve backpressure and propagate rejected ACKs", async () => {
  for (const rejectAck of [false, true]) {
    clock.value = 100;
    const acks = [];
    let disposed = 0;
    const writer = createWritableStreamFromHook({
      stream(path) {
        const ack = Promise.withResolvers();
        acks.push({ ...ack, method: path[0] });
        return { size: 100_000, promise: ack.promise };
      },
      dispose() {
        disposed++;
      },
    }).getWriter();
    const closed = writer.closed.catch((error) => error);
    await writer.write("one");
    await writer.write("two");
    let thirdDone = false;
    const third = writer.write("three").then(() => {
      thirdDone = true;
    });
    await flush();
    assert.equal(thirdDone, false);
    acks[0].resolve();
    await third;
    let fourthDone = false;
    const fourth = writer.write("four").then(
      () => {
        fourthDone = true;
      },
      (error) => error
    );
    await flush();
    assert.equal(fourthDone, false);
    const error = new Error("peer refused object");
    for (let i = 1; i < 4; i++) {
      if (rejectAck && i === 1) {
        acks[i].reject(error);
      } else {
        acks[i].resolve();
      }
      await flush();
    }
    if (rejectAck) {
      assert.equal(await fourth, error);
      assert.equal(await closed, error);
      await assert.rejects(writer.close());
      assert.equal(
        acks.some((ack) => ack.method === "close"),
        false
      );
      assert.equal(disposed, 1);
    } else {
      await fourth;
      assert.equal(fourthDone, true);
      const closing = writer.close();
      await flush();
      assert.equal(acks.at(-1).method, "close");
      acks.at(-1).resolve();
      await closing;
      await closed;
    }
  }
});
