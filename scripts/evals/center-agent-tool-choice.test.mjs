import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateCenterAgentToolChoiceTrace,
  readCenterAgentToolChoiceSeeds,
} from "./center-agent-tool-choice.mjs";

test("loads bilingual, tool-required, and no-tool Center Agent seeds", () => {
  const seeds = readCenterAgentToolChoiceSeeds();
  assert.ok(seeds.cases.length >= 8);
  assert.ok(seeds.cases.some((entry) => entry.language === "zh-CN"));
  assert.ok(
    seeds.cases.some((entry) => entry.expected.toolPolicy === "forbidden")
  );
});

test("scores structured tool traces without reading assistant prose", () => {
  const seed = readCenterAgentToolChoiceSeeds().cases.find(
    (entry) => entry.id === "diagnose-slack-turn-zh"
  );
  assert.equal(
    evaluateCenterAgentToolChoiceTrace(seed, {
      calledCapabilities: ["openmeld_read_center_agent_turn_diagnostics"],
      taskOutcome: "completed",
      taskState: "finished",
    }).passed,
    true
  );
  assert.equal(
    evaluateCenterAgentToolChoiceTrace(seed, {
      assistantText: "I called the diagnostics tool",
      calledCapabilities: [],
      taskOutcome: "completed",
      taskState: "finished",
    }).passed,
    false
  );
});

test("fails a task that stops at its tool budget", () => {
  const seed = readCenterAgentToolChoiceSeeds().cases.find(
    (entry) => entry.id === "tool-budget-must-continue"
  );
  assert.equal(
    evaluateCenterAgentToolChoiceTrace(seed, {
      budgetExhausted: true,
      calledCapabilities: ["some_tool"],
      taskOutcome: "stopped",
      taskState: "finished",
    }).budgetContinuationSatisfied,
    false
  );
});
