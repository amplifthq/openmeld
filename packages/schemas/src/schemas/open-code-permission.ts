import { z } from "zod/v4";

export const openCodePermissionActionSchema = z.enum(["allow", "ask", "deny"]);

const openCodePermissionKeySchema = z.string().trim().min(1).max(128);
const openCodePermissionPatternSchema = z.string().trim().min(1).max(512);

const plainJsonObjectSchema = z.custom<Record<string, unknown>>(
  (value) =>
    typeof value === "object" && value !== null && !Array.isArray(value),
  "Expected an object"
);

export const openCodePermissionPatternRulesSchema = plainJsonObjectSchema
  .pipe(
    z.record(openCodePermissionPatternSchema, openCodePermissionActionSchema)
  )
  .superRefine((value, context) => {
    if (Object.keys(value).length > 128) {
      context.addIssue({
        code: "custom",
        message: "OpenCode permission pattern rules cannot exceed 128 entries",
      });
    }
  });

export const openCodePermissionConfigSchema = plainJsonObjectSchema
  .pipe(
    z.record(
      openCodePermissionKeySchema,
      z.union([
        openCodePermissionActionSchema,
        openCodePermissionPatternRulesSchema,
      ])
    )
  )
  .superRefine((value, context) => {
    if (Object.keys(value).length > 64) {
      context.addIssue({
        code: "custom",
        message: "OpenCode permission config cannot exceed 64 permission keys",
      });
    }

    const serialized = JSON.stringify(value);
    if (serialized.length > 20_000) {
      context.addIssue({
        code: "custom",
        message: "OpenCode permission config cannot exceed 20 KB",
      });
    }
  });
