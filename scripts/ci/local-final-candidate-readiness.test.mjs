import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateLocalCandidateReadiness,
  renderLocalCandidateReadiness,
} from "./local-final-candidate-readiness.mjs";

const GIBIBYTE = 1024 ** 3;
const AVAILABLE_DISK_PATTERN = /Available disk: 3\.0 GiB/u;
const ACTIVE_STACKS_PATTERN = /Other active dev stacks: 1 \(18 processes\)/u;
const LOCAL_PROCEED_PATTERN = /The local fallback may proceed/u;
const SAFETY_FLOOR_PATTERN = /below the 1\.0 GiB machine-safety floor/u;

test("reports constrained local capacity without blocking agent judgment", () => {
  const readiness = evaluateLocalCandidateReadiness({
    activeStacks: [
      {
        processCount: 18,
        repoRoot: "/work/openmeld-worktrees/people",
      },
    ],
    availableBytes: 3 * GIBIBYTE,
    candidateRoot: "/work/openmeld-worktrees/candidate",
  });

  assert.equal(readiness.state, "constrained");
  assert.equal(readiness.blocked, false);
  const output = renderLocalCandidateReadiness(readiness);
  assert.match(output, AVAILABLE_DISK_PATTERN);
  assert.match(output, ACTIVE_STACKS_PATTERN);
  assert.match(output, LOCAL_PROCEED_PATTERN);
});

test("blocks only a critical disk floor that could destabilize the workstation", () => {
  const readiness = evaluateLocalCandidateReadiness({
    activeStacks: [],
    availableBytes: 0.75 * GIBIBYTE,
    candidateRoot: "/work/openmeld-worktrees/candidate",
  });

  assert.equal(readiness.state, "blocked");
  assert.equal(readiness.blocked, true);
  assert.match(renderLocalCandidateReadiness(readiness), SAFETY_FLOOR_PATTERN);
});
