import { toJsonSchema } from "@valibot/to-json-schema";
import type { RemoteAgentToolInputSchema } from "../agent-core/tool-definition";

export function toRemoteAgentToolJsonSchema(
  schema: RemoteAgentToolInputSchema
): Record<string, unknown> {
  return toJsonSchema(schema, {
    // JSON Schema cannot represent runtime-only normalization or custom
    // predicates. Ignore only the two actions used intentionally by current
    // tool schemas; every newly unsupported action must fail catalog
    // construction instead of degrading the model-visible type.
    errorMode: "throw",
    ignoreActions: ["check", "trim"],
    typeMode: "input",
  }) as Record<string, unknown>;
}
