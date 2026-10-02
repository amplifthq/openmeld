import type { z } from "zod/v4";
import type {
  desktopUpdateObservationResponseSchema,
  desktopUpdateObservationRpcInputSchema,
  desktopUpdateObservationSchema,
} from "../../schemas/http/inbox-desktop-updates";
export type DesktopUpdateObservation = z.infer<
  typeof desktopUpdateObservationSchema
>;
export type DesktopUpdateObservationResponse = z.infer<
  typeof desktopUpdateObservationResponseSchema
>;
export type DesktopUpdateObservationRpcInput = z.infer<
  typeof desktopUpdateObservationRpcInputSchema
>;
