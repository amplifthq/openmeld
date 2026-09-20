import * as z from "zod/v4";

/** Build-only, non-secret coordinates for OS-launched worktree applications. */
export const desktopDevelopmentContextSchema = z
  .strictObject({
    version: z.literal(1),
    repoRoot: z.string().min(1),
    laneId: z.string().regex(/^wt-[a-f0-9]{12}$/u),
    preset: z.enum(["dev-local", "canary"]),
    openMeldHome: z.string().min(1),
    webOrigin: z.url(),
    authOrigin: z.url(),
    gatewayOrigin: z.url(),
  })
  .superRefine((value, context) => {
    for (const key of ["webOrigin", "authOrigin", "gatewayOrigin"] as const) {
      const url = new URL(value[key]);
      if (
        url.origin !== value[key] ||
        url.protocol !== "http:" ||
        url.hostname !== `${value.laneId}.localhost` ||
        !url.port
      ) {
        context.addIssue({
          code: "custom",
          path: [key],
          message:
            "Development endpoints must match the worktree's loopback lane.",
        });
      }
    }
    if (
      new Set([value.webOrigin, value.authOrigin, value.gatewayOrigin]).size !==
      3
    ) {
      context.addIssue({
        code: "custom",
        message: "Development services require distinct ports.",
      });
    }
  });
export type DesktopDevelopmentContext = z.infer<
  typeof desktopDevelopmentContextSchema
>;
