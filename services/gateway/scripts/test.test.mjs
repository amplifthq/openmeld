import assert from "node:assert/strict";
import test from "node:test";
import { runGatewayTests } from "./test.mjs";

test("Gateway validation runs every shard and stops on failure", () => {
  const shards = [];
  assert.equal(
    runGatewayTests([], (_binary, args) => {
      shards.push(args[2]);
      return { status: 0 };
    }),
    0
  );
  assert.deepEqual(shards, [
    "--shard=1/4",
    "--shard=2/4",
    "--shard=3/4",
    "--shard=4/4",
  ]);
  let calls = 0;
  assert.equal(
    runGatewayTests([], () => {
      calls += 1;
      return { status: 2 };
    }),
    2
  );
  assert.equal(calls, 1);
});

test("an explicit test file runs once without empty shards", () => {
  const calls = [];
  assert.equal(
    runGatewayTests(
      ["tests/public-space-boundary.test.ts"],
      (_binary, args) => {
        calls.push(args.slice(1));
        return { status: 0 };
      }
    ),
    0
  );
  assert.deepEqual(calls, [["run", "tests/public-space-boundary.test.ts"]]);
});
