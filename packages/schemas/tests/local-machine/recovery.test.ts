import { describe, expect, it } from "vitest";
import {
  LOCAL_MACHINE_RECOVERY_POLICY_BY_CODE,
  localMachineIssueAgentEventSchema,
  localMachineIssueSchema,
  resolveLocalMachineRecoveryPolicy,
} from "../../src";

const STORAGE_ISSUE = {
  schemaVersion: 1,
  code: "local_machine.storage.exhausted",
  operation: "create_lock",
  recoveryPolicy: "user_action",
  summary:
    "Your computer is out of storage space. OpenMeld can't save the local files it needs.",
  primaryAction: "Free up storage, then try again.",
  diagnostics: {
    systemCode: "ENOSPC",
    detail: "no space left on device",
  },
} as const;

describe("local machine recovery schemas", () => {
  it("parses the shared user-facing issue", () => {
    expect(localMachineIssueSchema.parse(STORAGE_ISSUE)).toEqual(STORAGE_ISSUE);
  });

  it("requires the Agent View event code to match the issue code", () => {
    const result = localMachineIssueAgentEventSchema.safeParse({
      type: "error",
      code: "local_machine.resources.exhausted",
      message: `${STORAGE_ISSUE.summary} ${STORAGE_ISSUE.primaryAction}`,
      payload: {
        localMachineIssue: STORAGE_ISSUE,
      },
    });

    expect(result.success).toBe(false);
  });

  it("requires each issue to use the shared recovery policy for its code", () => {
    const result = localMachineIssueSchema.safeParse({
      ...STORAGE_ISSUE,
      recoveryPolicy: "automatic",
    });

    expect(result.success).toBe(false);
  });

  it("requires the Agent View message to match the shared issue copy", () => {
    const result = localMachineIssueAgentEventSchema.safeParse({
      type: "error",
      code: STORAGE_ISSUE.code,
      message: "Run openmeld repair.",
      payload: {
        localMachineIssue: STORAGE_ISSUE,
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects undeclared fields so clients do not drift into a second contract", () => {
    const result = localMachineIssueSchema.safeParse({
      ...STORAGE_ISSUE,
      repairCommand: "openmeld repair",
    });

    expect(result.success).toBe(false);
  });

  it("owns the recovery policy for every code consumed by product clients", () => {
    expect(LOCAL_MACHINE_RECOVERY_POLICY_BY_CODE).toMatchObject({
      "local_machine.storage.exhausted": "user_action",
      "local_machine.concurrency.orphaned": "user_action",
      "local_machine.failure.unknown": "diagnostics",
    });
    expect(
      resolveLocalMachineRecoveryPolicy("local_machine.storage.exhausted")
    ).toBe("user_action");
    expect(
      resolveLocalMachineRecoveryPolicy("prepare.refresh_service.failed")
    ).toBeNull();
  });
});
