import { z } from "zod/v4";

export const LOCAL_MACHINE_RECOVERY_SCHEMA_VERSION = 1 as const;

export const localMachineIssueCodeSchema = z.enum([
  "local_machine.storage.exhausted",
  "local_machine.storage.not_writable",
  "local_machine.permission.denied",
  "local_machine.resources.exhausted",
  "local_machine.background_execution.blocked",
  "local_machine.concurrency.active",
  "local_machine.concurrency.orphaned",
  "local_machine.failure.unknown",
]);

export const localMachineOperationSchema = z.enum([
  "create_lock",
  "read_local_state",
  "write_local_state",
  "start_background_service",
  "start_process",
  "unknown",
]);

export const localMachineRecoveryPolicySchema = z.enum([
  "automatic",
  "retry_with_backoff",
  "user_action",
  "diagnostics",
]);

export const LOCAL_MACHINE_RECOVERY_POLICY_BY_CODE = {
  "local_machine.storage.exhausted": "user_action",
  "local_machine.storage.not_writable": "user_action",
  "local_machine.permission.denied": "user_action",
  "local_machine.resources.exhausted": "user_action",
  "local_machine.background_execution.blocked": "user_action",
  "local_machine.concurrency.active": "user_action",
  "local_machine.concurrency.orphaned": "user_action",
  "local_machine.failure.unknown": "diagnostics",
} as const satisfies Record<
  z.infer<typeof localMachineIssueCodeSchema>,
  z.infer<typeof localMachineRecoveryPolicySchema>
>;

export function resolveLocalMachineRecoveryPolicy(
  code: string
): z.infer<typeof localMachineRecoveryPolicySchema> | null {
  if (!Object.hasOwn(LOCAL_MACHINE_RECOVERY_POLICY_BY_CODE, code)) {
    return null;
  }
  return LOCAL_MACHINE_RECOVERY_POLICY_BY_CODE[
    code as keyof typeof LOCAL_MACHINE_RECOVERY_POLICY_BY_CODE
  ];
}

const localMachineUserMessageSchema = z.string().trim().min(1).max(512);
const localMachineDiagnosticTextSchema = z.string().trim().min(1).max(2048);
const localMachineAgentMessageSchema = z.string().trim().min(1).max(1025);

export function formatLocalMachineIssueMessage(issue: {
  primaryAction: string | null;
  summary: string;
}): string {
  return issue.primaryAction
    ? `${issue.summary} ${issue.primaryAction}`
    : issue.summary;
}

export const localMachineIssueSchema = z
  .strictObject({
    schemaVersion: z.literal(LOCAL_MACHINE_RECOVERY_SCHEMA_VERSION),
    code: localMachineIssueCodeSchema,
    operation: localMachineOperationSchema,
    recoveryPolicy: localMachineRecoveryPolicySchema,
    summary: localMachineUserMessageSchema,
    primaryAction: z.union([localMachineUserMessageSchema, z.null()]),
    diagnostics: z.strictObject({
      systemCode: z.union([z.string().trim().min(1).max(64), z.null()]),
      detail: z.union([localMachineDiagnosticTextSchema, z.null()]),
    }),
  })
  .superRefine((value, context) => {
    const expectedPolicy = resolveLocalMachineRecoveryPolicy(value.code);
    if (value.recoveryPolicy !== expectedPolicy) {
      context.addIssue({
        code: "custom",
        message: `recovery policy must be ${expectedPolicy} for ${value.code}`,
        path: ["recoveryPolicy"],
      });
    }
  });

export const localMachineIssueAgentEventSchema = z
  .strictObject({
    type: z.literal("error"),
    code: localMachineIssueCodeSchema,
    message: localMachineAgentMessageSchema,
    requestId: z.string().trim().min(1).max(256).optional(),
    payload: z.strictObject({
      localMachineIssue: localMachineIssueSchema,
    }),
  })
  .superRefine((value, context) => {
    if (value.code !== value.payload.localMachineIssue.code) {
      context.addIssue({
        code: "custom",
        message: "agent event code must match local machine issue code",
        path: ["code"],
      });
    }
    const expectedMessage = formatLocalMachineIssueMessage(
      value.payload.localMachineIssue
    );
    if (value.message !== expectedMessage) {
      context.addIssue({
        code: "custom",
        message: "agent event message must match local machine issue copy",
        path: ["message"],
      });
    }
  });

export type LocalMachineIssue = z.infer<typeof localMachineIssueSchema>;
export type LocalMachineIssueCode = z.infer<typeof localMachineIssueCodeSchema>;
export type LocalMachineOperation = z.infer<typeof localMachineOperationSchema>;
export type LocalMachineRecoveryPolicy = z.infer<
  typeof localMachineRecoveryPolicySchema
>;
export type LocalMachineIssueAgentEvent = z.infer<
  typeof localMachineIssueAgentEventSchema
>;
