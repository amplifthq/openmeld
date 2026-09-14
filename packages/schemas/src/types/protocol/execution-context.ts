import type { z } from "zod/v4";

type Schemas = typeof import("../../schemas/protocol/execution-context");
export type ExecutionContextSelection = z.infer<
  Schemas["executionContextSelectionSchema"]
>;
export type ExecutionContextScope = z.infer<
  Schemas["executionContextScopeSchema"]
>;
export type ExecutionContextRequest = z.infer<
  Schemas["executionContextRequestSchema"]
>;
export type ExecutionContextAssignment = z.infer<
  Schemas["executionContextAssignmentSchema"]
>;
export type ExecutionContextCompletion = z.infer<
  Schemas["executionContextCompletionSchema"]
>;
export type ExecutionContextTask = z.infer<
  Schemas["executionContextTaskSchema"]
>;
