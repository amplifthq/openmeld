import type { z } from "zod/v4";

type OpenCodePermissionActionSchema =
  typeof import("../schemas/open-code-permission")["openCodePermissionActionSchema"];
type OpenCodePermissionConfigSchema =
  typeof import("../schemas/open-code-permission")["openCodePermissionConfigSchema"];
type OpenCodePermissionPatternRulesSchema =
  typeof import("../schemas/open-code-permission")["openCodePermissionPatternRulesSchema"];

export type OpenCodePermissionAction = z.infer<OpenCodePermissionActionSchema>;
export type OpenCodePermissionConfig = z.infer<OpenCodePermissionConfigSchema>;
export type OpenCodePermissionPatternRules =
  z.infer<OpenCodePermissionPatternRulesSchema>;
