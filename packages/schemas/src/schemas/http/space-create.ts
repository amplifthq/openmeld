import { z } from "zod/v4";
import {
  spaceAccessModeSchema,
  spaceAccessModeUsesPassword,
} from "./space-access-mode";
import { spaceOrganizationVisibilitySchema } from "./space-meta";
import { spacePasswordSchema } from "./space-password";

export const createSpaceBodySchema = z
  .strictObject({
    name: z.unknown().optional(),
    purpose: z.unknown().optional(),
    guide: z.unknown().optional(),
    visibility: z.unknown().optional(),
    accessMode: z.unknown().optional(),
    password: z.unknown().optional(),
  })
  .transform((value, ctx) => {
    type CreateSpaceBodyOutput = {
      name?: string;
      purpose?: string;
      guide?: string;
      visibility: z.infer<typeof spaceOrganizationVisibilitySchema>;
      accessMode?: z.infer<typeof spaceAccessModeSchema>;
      password?: string;
    };
    const next: Omit<CreateSpaceBodyOutput, "visibility"> = {};

    if (typeof value.name === "string") {
      const normalizedName = value.name.trim();
      if (normalizedName.length > 0) {
        next.name = normalizedName;
      }
    }

    if (Object.hasOwn(value, "purpose")) {
      if (typeof value.purpose !== "string") {
        ctx.addIssue({
          code: "custom",
          message: "Invalid purpose",
          path: ["purpose"],
        });
        return z.NEVER;
      }
      next.purpose = value.purpose.trim();
    }

    if (Object.hasOwn(value, "guide")) {
      if (typeof value.guide !== "string") {
        ctx.addIssue({
          code: "custom",
          message: "Invalid guide",
          path: ["guide"],
        });
        return z.NEVER;
      }
      next.guide = value.guide.trim();
    }

    const parsedVisibility = spaceOrganizationVisibilitySchema.safeParse(
      value.visibility
    );
    if (!parsedVisibility.success) {
      ctx.addIssue({
        code: "custom",
        message: "Invalid visibility",
        path: ["visibility"],
      });
      return z.NEVER;
    }

    if (Object.hasOwn(value, "accessMode")) {
      const parsedAccessMode = spaceAccessModeSchema.safeParse(
        value.accessMode
      );
      if (!parsedAccessMode.success) {
        ctx.addIssue({
          code: "custom",
          message: "Invalid accessMode",
          path: ["accessMode"],
        });
        return z.NEVER;
      }
      next.accessMode = parsedAccessMode.data;
    }

    if (Object.hasOwn(value, "password")) {
      const parsedPassword = spacePasswordSchema.safeParse(value.password);
      if (!parsedPassword.success) {
        ctx.addIssue({
          code: "custom",
          message: "Invalid password",
          path: ["password"],
        });
        return z.NEVER;
      }
      next.password = parsedPassword.data;
    }

    if (
      next.accessMode !== undefined &&
      !spaceAccessModeUsesPassword(next.accessMode) &&
      next.password !== undefined
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Password cannot be set for this access",
        path: ["password"],
      });
      return z.NEVER;
    }

    if (
      next.accessMode !== undefined &&
      spaceAccessModeUsesPassword(next.accessMode) &&
      next.password === undefined
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Password required for this access",
        path: ["password"],
      });
      return z.NEVER;
    }

    return {
      ...next,
      visibility: parsedVisibility.data,
    };
  });
