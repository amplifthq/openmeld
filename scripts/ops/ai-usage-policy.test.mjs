import assert from "node:assert/strict";
import { test } from "node:test";
import { dailyUsdToNanoUsd } from "./ai-usage-policy.mjs";

test("optional allowances preserve exact fractional dollars and distinguish zero from unlimited", () => {
  assert.equal(dailyUsdToNanoUsd("unlimited"), null);
  assert.equal(dailyUsdToNanoUsd("0"), 0);
  assert.equal(dailyUsdToNanoUsd("1"), 1_000_000_000);
  assert.equal(dailyUsdToNanoUsd("0.000000001"), 1);
  assert.equal(dailyUsdToNanoUsd("0.123456789"), 123_456_789);
  for (const invalid of [
    "-1",
    "NaN",
    "1e3",
    "0.0000000001",
    "9007199254740991",
  ]) {
    assert.throws(() => dailyUsdToNanoUsd(invalid));
  }
});
