import * as z from "zod/v4";
import { profileSpaceHistoryGatewayHostSchema } from "./schemas/http/profile-space-history";

export const clientEnvironmentResponseSchema = z.strictObject({
  gatewayHost: profileSpaceHistoryGatewayHostSchema,
});
export type ClientEnvironmentResponse = z.infer<
  typeof clientEnvironmentResponseSchema
>;
