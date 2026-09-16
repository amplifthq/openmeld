import type { z } from "zod/v4";

type ReceiptSchemas =
  typeof import("../../schemas/space-mesh/dispatch-space-action-receipt");

export type DispatchSpaceActionClosedReasonCode = z.infer<
  ReceiptSchemas["dispatchSpaceActionClosedReasonCodeSchema"]
>;
export type DispatchSpaceActionReceipt = z.infer<
  ReceiptSchemas["dispatchSpaceActionReceiptSchema"]
>;
export type DispatchSpaceActionToolResult = z.infer<
  ReceiptSchemas["dispatchSpaceActionToolResultSchema"]
>;
