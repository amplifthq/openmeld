import type { z } from "zod/v4";

type SetAuthPasswordBodySchema =
  typeof import("../../schemas/http/auth-password")["setAuthPasswordBodySchema"];
type SetAuthPasswordResponseSchema =
  typeof import("../../schemas/http/auth-password")["setAuthPasswordResponseSchema"];

export type SetAuthPasswordBody = z.infer<SetAuthPasswordBodySchema>;
export type SetAuthPasswordResponse = z.infer<SetAuthPasswordResponseSchema>;
