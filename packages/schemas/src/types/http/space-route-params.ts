import type { z } from "zod/v4";
import type { spaceRouteParamsSchema } from "../../schemas/http/space-route-params";

export type SpaceRouteParams = z.infer<typeof spaceRouteParamsSchema>;
