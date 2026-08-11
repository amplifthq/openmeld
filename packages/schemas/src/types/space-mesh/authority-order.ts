import type { z } from "zod/v4";

type SpaceAuthorityOrderSchema =
  typeof import("../../schemas/space-mesh/authority-order")["spaceAuthorityOrderSchema"];

export type SpaceAuthorityOrder = z.infer<SpaceAuthorityOrderSchema>;
