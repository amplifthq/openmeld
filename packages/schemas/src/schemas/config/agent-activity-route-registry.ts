import { z } from "zod/v4";

export const AGENT_ACTIVITY_ROUTE_REGISTRY_VERSION = 1 as const;

export const agentActivityRouteRegistrySchema = z
  .strictObject({
    routes: z
      .array(
        z.strictObject({
          rootDir: z.string().trim().min(1).max(4096),
        })
      )
      .max(64),
    version: z.literal(AGENT_ACTIVITY_ROUTE_REGISTRY_VERSION),
  })
  .superRefine((value, context) => {
    const rootDirs = new Set<string>();
    for (const [index, route] of value.routes.entries()) {
      if (rootDirs.has(route.rootDir)) {
        context.addIssue({
          code: "custom",
          message: "Agent Activity route roots must be unique.",
          path: ["routes", index, "rootDir"],
        });
      }
      rootDirs.add(route.rootDir);
    }
  });

export type AgentActivityRouteRegistry = z.infer<
  typeof agentActivityRouteRegistrySchema
>;
