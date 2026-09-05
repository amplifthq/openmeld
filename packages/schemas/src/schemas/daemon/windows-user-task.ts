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
