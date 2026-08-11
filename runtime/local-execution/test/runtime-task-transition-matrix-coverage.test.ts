import { describe, expect, it } from "vitest";
import {
  RUNTIME_COMPENSATION_TRANSITION_MATRIX,
  RUNTIME_INFLIGHT_TASK_TRANSITION_MATRIX,
  RUNTIME_REPLAY_TRANSITION_MATRIX,
  RUNTIME_TASK_RESULT_TRANSITION_MATRIX,
  type RuntimeCompensationTransitionKind,
  type RuntimeInflightTaskTransitionKind,
  type RuntimeReplayTransitionKind,
  type RuntimeTaskResultTransitionKind,
} from "../src/runtime-task-lifecycle-contract";

const EXPECTED_INFLIGHT_TRANSITION_KINDS: Record<
  RuntimeInflightTaskTransitionKind,
  true
> = {
  refresh_tracked_inflight_task: true,
  settle_tracked_inflight_task: true,
  track_new_inflight_task: true,
};

const EXPECTED_REPLAY_TRANSITION_KINDS: Record<
  RuntimeReplayTransitionKind,
  true
> = {
  commit_recovery_replay: true,
  settle_committed_replay: true,
  surface_replay_candidate: true,
};

const EXPECTED_TASK_RESULT_TRANSITION_KINDS: Record<
  RuntimeTaskResultTransitionKind,
  true
> = {
  emit_failed_payload: true,
  emit_partial_success_payload: true,
  emit_success_payload: true,
};

const EXPECTED_COMPENSATION_TRANSITION_KINDS: Record<
  RuntimeCompensationTransitionKind,
  true
> = {
  exhaust_failed_compensation: true,
  schedule_next_compensation: true,
  settle_successful_compensation: true,
};

const sortStrings = (values: Iterable<string>): string[] =>
  [...values].sort((left, right) => left.localeCompare(right));

describe("runtime task transition matrix coverage", () => {
  it("keeps inflight transition matrix exhaustive and unique", () => {
    const transitionKinds = Object.values(
      RUNTIME_INFLIGHT_TASK_TRANSITION_MATRIX
    ).map(({ kind }) => kind);

    expect(sortStrings(transitionKinds)).toEqual(
      sortStrings(Object.keys(EXPECTED_INFLIGHT_TRANSITION_KINDS))
    );
    expect(new Set(transitionKinds).size).toBe(transitionKinds.length);
    for (const transition of Object.values(
      RUNTIME_INFLIGHT_TASK_TRANSITION_MATRIX
    )) {
      expect(transition.allowedFromStates.length).toBeGreaterThan(0);
    }
  });

  it("keeps replay transition matrix exhaustive and unique", () => {
    const transitionKinds = Object.values(RUNTIME_REPLAY_TRANSITION_MATRIX).map(
      ({ kind }) => kind
    );

    expect(sortStrings(transitionKinds)).toEqual(
      sortStrings(Object.keys(EXPECTED_REPLAY_TRANSITION_KINDS))
    );
    expect(new Set(transitionKinds).size).toBe(transitionKinds.length);
    for (const transition of Object.values(RUNTIME_REPLAY_TRANSITION_MATRIX)) {
      expect(transition.allowedFromStates.length).toBeGreaterThan(0);
    }
  });

  it("keeps task result transition matrix exhaustive and unique", () => {
    const transitionKinds = Object.values(
      RUNTIME_TASK_RESULT_TRANSITION_MATRIX
    ).map(({ kind }) => kind);

    expect(sortStrings(transitionKinds)).toEqual(
      sortStrings(Object.keys(EXPECTED_TASK_RESULT_TRANSITION_KINDS))
    );
    expect(new Set(transitionKinds).size).toBe(transitionKinds.length);
    for (const transition of Object.values(
      RUNTIME_TASK_RESULT_TRANSITION_MATRIX
    )) {
      expect(transition.allowedFromStates.length).toBeGreaterThan(0);
    }
  });

  it("keeps compensation transition matrix exhaustive and unique", () => {
    const transitionKinds = Object.values(
      RUNTIME_COMPENSATION_TRANSITION_MATRIX
    ).map(({ kind }) => kind);

    expect(sortStrings(transitionKinds)).toEqual(
      sortStrings(Object.keys(EXPECTED_COMPENSATION_TRANSITION_KINDS))
    );
    expect(new Set(transitionKinds).size).toBe(transitionKinds.length);
    for (const transition of Object.values(
      RUNTIME_COMPENSATION_TRANSITION_MATRIX
    )) {
      expect(transition.allowedFromStates.length).toBeGreaterThan(0);
    }
  });
});
