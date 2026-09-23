import * as z from "zod/v4";

// Local Node/PowerShell boundary only; these are not Runtime Transport fields.
export const windowsUserTaskRequestSchema = z.strictObject({
  name: z.string().min(1),
  legacyScript: z.string().min(1),
  operation: z.enum([
    "install",
    "status",
    "start",
    "stop",
    "enable",
    "disable",
    "uninstall",
  ]),
  executable: z.string().optional(),
  arguments: z.string().optional(),
  workingDirectory: z.string().optional(),
  periodic: z.boolean().optional(),
});
export type WindowsUserTaskRequest = z.infer<
  typeof windowsUserTaskRequestSchema
>;

export const windowsUserTaskStatusSchema = z.strictObject({
  installed: z.boolean(),
  running: z.boolean(),
  enabled: z.boolean(),
  legacy: z.boolean(),
  actionArguments: z.string().nullable(),
});

export const windowsUserTaskActionSchema = z.strictObject({
  executable: z.string().min(1),
  args: z.array(z.string()),
  env: z.record(z.string(), z.string()),
  logPath: z.string().min(1),
});
export type WindowsUserTaskAction = z.infer<typeof windowsUserTaskActionSchema>;

// Released CLI writers spread their registration spec into the encoded action.
// Accept only those known historical string fields on read, then return the
// canonical action. Task Scheduler still owns cwd; pendingJobPath is not an
// execution parameter. Do not loosen the canonical schema or pass unknown keys.
export const windowsUserTaskStoredActionSchema = windowsUserTaskActionSchema
  .extend({
    workingDirectory: z.string().optional(),
    pendingJobPath: z.string().optional(),
  })
  .transform(({ executable, args, env, logPath }) => ({
    executable,
    args,
    env,
    logPath,
  }));
