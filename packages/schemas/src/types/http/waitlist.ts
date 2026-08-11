import type { z } from "zod/v4";

type WaitlistJoinStatusSchema =
  typeof import("../../schemas/http/waitlist")["waitlistJoinStatusSchema"];
type JoinWaitlistBodySchema =
  typeof import("../../schemas/http/waitlist")["joinWaitlistBodySchema"];
type JoinWaitlistResponseSchema =
  typeof import("../../schemas/http/waitlist")["joinWaitlistResponseSchema"];
type WaitlistErrorCodeSchema =
  typeof import("../../schemas/http/waitlist")["waitlistErrorCodeSchema"];
type WaitlistErrorResponseSchema =
  typeof import("../../schemas/http/waitlist")["waitlistErrorResponseSchema"];

export type WaitlistJoinStatus = z.infer<WaitlistJoinStatusSchema>;
export type JoinWaitlistBody = z.infer<JoinWaitlistBodySchema>;
export type JoinWaitlistResponse = z.infer<JoinWaitlistResponseSchema>;
export type WaitlistErrorCode = z.infer<WaitlistErrorCodeSchema>;
export type WaitlistErrorResponse = z.infer<WaitlistErrorResponseSchema>;
