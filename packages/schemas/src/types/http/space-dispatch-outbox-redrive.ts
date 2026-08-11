import type { z } from "zod/v4";

export type SpaceDispatchOutboxRedriveReason = z.infer<
  typeof import("../../schemas/http/space-dispatch-outbox-redrive")["spaceDispatchOutboxRedriveReasonSchema"]
>;

export type PostSpaceDispatchOutboxRedriveBody = z.infer<
  typeof import("../../schemas/http/space-dispatch-outbox-redrive")["postSpaceDispatchOutboxRedriveBodySchema"]
>;

export type PostSpaceDispatchOutboxRedriveResponse = z.infer<
  typeof import("../../schemas/http/space-dispatch-outbox-redrive")["postSpaceDispatchOutboxRedriveResponseSchema"]
>;
