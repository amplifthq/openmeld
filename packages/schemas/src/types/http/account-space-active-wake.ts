import type { z } from "zod/v4";

type AccountSpaceActiveWakeSummaryItemSchema =
  typeof import("../../schemas/http/account-space-active-wake")["accountSpaceActiveWakeSummaryItemSchema"];
type AccountSpaceActiveWakeSummaryQuerySchema =
  typeof import("../../schemas/http/account-space-active-wake")["accountSpaceActiveWakeSummaryQuerySchema"];
type AccountSpaceActiveWakeSummaryResponseSchema =
  typeof import("../../schemas/http/account-space-active-wake")["accountSpaceActiveWakeSummaryResponseSchema"];
type AccountSpaceActiveWakeSummaryRpcInputSchema =
  typeof import("../../schemas/http/account-space-active-wake")["accountSpaceActiveWakeSummaryRpcInputSchema"];

export type AccountSpaceActiveWakeSummaryItem =
  z.infer<AccountSpaceActiveWakeSummaryItemSchema>;
export type AccountSpaceActiveWakeSummaryQuery =
  z.infer<AccountSpaceActiveWakeSummaryQuerySchema>;
export type AccountSpaceActiveWakeSummaryResponse =
  z.infer<AccountSpaceActiveWakeSummaryResponseSchema>;
export type AccountSpaceActiveWakeSummaryRpcInput =
  z.infer<AccountSpaceActiveWakeSummaryRpcInputSchema>;
