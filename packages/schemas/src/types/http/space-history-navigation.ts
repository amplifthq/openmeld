import type * as z from "zod/v4";

export type SpaceHistoryNavigation = z.infer<
  typeof import("../../schemas/http/space-history-navigation").spaceHistoryNavigationSchema
>;
export type SpaceHistoryNavigationQuery = z.infer<
  typeof import("../../schemas/http/space-history-navigation").spaceHistoryNavigationQuerySchema
>;
