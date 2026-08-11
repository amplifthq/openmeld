import type { z } from "zod/v4";

type SpaceBootstrapResponseSchema =
  typeof import("../../schemas/http/space-bootstrap")["spaceBootstrapResponseSchema"];

export type SpaceBootstrapResponse = z.infer<SpaceBootstrapResponseSchema>;
