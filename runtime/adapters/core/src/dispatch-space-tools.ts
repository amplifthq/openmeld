import { spaceMessageFileReferenceSchema } from "@openmeld/schemas";
import { z } from "zod/v4";

/** Native carriers share these definitions and a single dispatch-owned recorder. */
export type AdapterDispatchSpaceTool = {
  name: string;
  title?: string;
  description: string;
  inputSchema: z.ZodObject;
  outputSchema?: z.ZodObject;
  annotations?: {
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
    readOnlyHint?: boolean;
  };
};

export type AdapterDispatchSpaceToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

/** Host-only capability. Never serialize it into a thread, ledger, or model input. */
export type AdapterDispatchSpaceTools = {
  readonly tools: readonly AdapterDispatchSpaceTool[];
  readonly deliveryOnly: boolean;
  call: (
    name: string,
    args: unknown
  ) => Promise<AdapterDispatchSpaceToolResult>;
  close: () => void;
};

/** Deliberate public output only; never infer this object from private prose. */
export const dispatchSpaceFinalOutcomeSchema = z
  .strictObject({
    action: z.enum(["reply", "stay_silent"]),
    text: z.string().trim().min(1),
    files: z.array(spaceMessageFileReferenceSchema).max(10),
    mentionTargets: z.array(z.string().min(1)),
    referenceTargets: z.array(z.string().min(1)),
    wakeTargets: z.array(z.string().min(1)),
  })
  .superRefine((value, ctx) => {
    if (
      value.action === "stay_silent" &&
      (value.files.length ||
        value.mentionTargets.length ||
        value.referenceTargets.length ||
        value.wakeTargets.length)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["action"],
        message: "A silent outcome cannot attach files or address recipients.",
      });
    }
  });

export const DISPATCH_SPACE_FINAL_OUTCOME_JSON_SCHEMA = z.toJSONSchema(
  dispatchSpaceFinalOutcomeSchema,
  { target: "draft-7" }
);

export function recordDispatchSpaceFinalOutcome(
  tools: AdapterDispatchSpaceTools,
  value: unknown
): Promise<AdapterDispatchSpaceToolResult> {
  const outcome = dispatchSpaceFinalOutcomeSchema.parse(value);
  return outcome.action === "reply"
    ? tools.call("reply", {
        message: outcome.text,
        files: outcome.files,
        mentionTargets: outcome.mentionTargets,
        referenceTargets: outcome.referenceTargets,
        wakeTargets: outcome.wakeTargets,
      })
    : tools.call("stay_silent", { reason: outcome.text });
}

export const DISPATCH_SPACE_ACTION_DELIVERY_ONLY_ENV =
  "OPENMELD_SPACE_ACTION_DELIVERY_ONLY";

export function isDispatchSpaceActionDeliveryOnly(
  env: Record<string, string | undefined> | undefined
): boolean {
  return env?.[DISPATCH_SPACE_ACTION_DELIVERY_ONLY_ENV] === "1";
}
