import assert from "node:assert/strict";
import test from "node:test";
import { checkCliSkill } from "./cli-skill-check.mjs";

const VERIFICATION_FAILURE = /CLI Skill verification failed/u;

test("stops on a failed schema build or signature check without signing content", () => {
  for (const statuses of [[1], [0, 1], [0, 0]]) {
    const calls = [];
    const verify = () =>
      checkCliSkill({
        cwd: "/exact-release-source",
        run: (command, args, options) => {
          calls.push({ command, args, cwd: options.cwd });
          return { status: statuses[calls.length - 1] };
        },
      });
    if (statuses.includes(1)) {
      assert.throws(verify, VERIFICATION_FAILURE);
    } else {
      assert.doesNotThrow(verify);
    }
    assert.equal(calls.length, statuses.length);
    assert.ok(calls.every((call) => call.cwd === "/exact-release-source"));
    assert.deepEqual(calls[0].args, [
      "exec",
      "turbo",
      "run",
      "build",
      "--filter=@openmeld/schemas",
    ]);
    if (calls[1]) {
      assert.deepEqual(calls[1].args, [
        "scripts/release/cli-skill.mjs",
        "check",
      ]);
    }
  }
});
