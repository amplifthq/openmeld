import type { z } from "zod/v4";

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

export const DISPATCH_SPACE_ACTION_DELIVERY_ONLY_ENV =
  "OPENMELD_SPACE_ACTION_DELIVERY_ONLY";

export function isDispatchSpaceActionDeliveryOnly(
  env: Record<string, string | undefined> | undefined
): boolean {
  return env?.[DISPATCH_SPACE_ACTION_DELIVERY_ONLY_ENV] === "1";
}
