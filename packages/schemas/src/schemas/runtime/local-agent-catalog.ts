import { z } from "zod/v4";

const LOCAL_AGENT_CATALOG_BOUNDED_ID_SCHEMA = z.string().trim().min(1).max(256);
const LOCAL_AGENT_CATALOG_BOUNDED_LABEL_SCHEMA = z
  .string()
  .trim()
  .min(1)
  .max(256);

export const localAgentCatalogTargetKindSchema = z.enum(["builtin", "custom"]);

export const localAgentCatalogLifecycleStatusSchema = z.enum([
  "active",
  "suspended",
]);

export const localAgentCatalogSelectableReasonSchema = z.enum([
  "not_detected",
  "not_supported_yet",
  "needs_repair",
  "custom_coming_soon",
]);

export const localAgentCatalogLaunchStatusSchema = z.enum([
  "ready",
  "needs_choice",
  "needs_repair",
  "not_available",
]);

type LocalAgentCatalogEntryValue = {
  agentId: string;
  displayName: string;
  targetKind: z.infer<typeof localAgentCatalogTargetKindSchema>;
  detected: boolean;
  enabled: boolean;
  launchStatus: z.infer<typeof localAgentCatalogLaunchStatusSchema>;
  selectable: boolean;
  selectableReason: z.infer<
    typeof localAgentCatalogSelectableReasonSchema
  > | null;
};

type LocalAgentCatalogSummaryValue = {
  totalBuiltins: number;
  detectedSupported: number;
  needsChoice: number;
  needsRepair: number;
  detectedNotSupportedYet: number;
  notDetected: number;
  entries: LocalAgentCatalogEntryValue[];
};

const localAgentCatalogEntryShape = {
  agentId: LOCAL_AGENT_CATALOG_BOUNDED_ID_SCHEMA,
  displayName: LOCAL_AGENT_CATALOG_BOUNDED_LABEL_SCHEMA,
  targetKind: localAgentCatalogTargetKindSchema,
  detected: z.boolean(),
  enabled: z.boolean(),
  launchStatus: localAgentCatalogLaunchStatusSchema,
  selectable: z.boolean(),
  selectableReason: z.union([
    localAgentCatalogSelectableReasonSchema,
    z.null(),
  ]),
};

export const localAgentCatalogEntrySchema = z
  .strictObject(localAgentCatalogEntryShape)
  .superRefine(validateLocalAgentCatalogEntrySemantics);

export const localAgentCatalogEntryWithLifecycleSchema = z
  .strictObject({
    ...localAgentCatalogEntryShape,
    lifecycleStatus: localAgentCatalogLifecycleStatusSchema.default("active"),
  })
  .superRefine(validateLocalAgentCatalogEntrySemantics);

export const localAgentCatalogSchema = createLocalAgentCatalogSchema(
  localAgentCatalogEntrySchema
);

export const localAgentCatalogWithLifecycleSchema =
  createLocalAgentCatalogSchema(localAgentCatalogEntryWithLifecycleSchema);

function createLocalAgentCatalogSchema<
  TEntrySchema extends z.ZodType<LocalAgentCatalogEntryValue>,
>(entrySchema: TEntrySchema) {
  return z
    .strictObject({
      totalBuiltins: z.number().int().min(0),
      detectedSupported: z.number().int().min(0),
      needsChoice: z.number().int().min(0),
      needsRepair: z.number().int().min(0),
      detectedNotSupportedYet: z.number().int().min(0),
      notDetected: z.number().int().min(0),
      entries: z.array(entrySchema),
    })
    .superRefine(validateLocalAgentCatalogSummary);
}

function validateLocalAgentCatalogEntrySemantics(
  value: LocalAgentCatalogEntryValue,
  ctx: z.RefinementCtx
) {
  if (value.selectable && value.selectableReason !== null) {
    ctx.addIssue({
      code: "custom",
      message: "selectableReason must be null when selectable is true",
      path: ["selectableReason"],
    });
  }
  if (!value.selectable && value.selectableReason === null) {
    ctx.addIssue({
      code: "custom",
      message: "selectableReason must be present when selectable is false",
      path: ["selectableReason"],
    });
  }
  if (
    value.launchStatus === "needs_choice" &&
    !(value.detected && value.targetKind === "builtin" && value.selectable)
  ) {
    ctx.addIssue({
      code: "custom",
      message:
        "needs_choice launchStatus only applies to detected selectable builtin entries",
      path: ["launchStatus"],
    });
  }
  if (
    value.launchStatus === "needs_repair" &&
    !(
      value.detected &&
      value.enabled &&
      value.targetKind === "builtin" &&
      value.selectable &&
      value.selectableReason === null
    )
  ) {
    ctx.addIssue({
      code: "custom",
      message:
        "needs_repair launchStatus only applies to detected selectable builtin entries",
      path: ["launchStatus"],
    });
  }
  if (value.selectableReason === "not_detected" && value.detected) {
    ctx.addIssue({
      code: "custom",
      message: "not_detected selectableReason requires detected to be false",
      path: ["detected"],
    });
  }
  if (
    value.selectableReason === "not_supported_yet" &&
    (!value.detected || value.targetKind !== "builtin")
  ) {
    ctx.addIssue({
      code: "custom",
      message:
        "not_supported_yet selectableReason only applies to detected builtin entries",
      path: ["selectableReason"],
    });
  }
  if (
    value.selectableReason === "needs_repair" &&
    (!value.detected || value.targetKind !== "builtin")
  ) {
    ctx.addIssue({
      code: "custom",
      message:
        "needs_repair selectableReason only applies to detected builtin entries",
      path: ["selectableReason"],
    });
  }
  if (
    value.selectableReason === "custom_coming_soon" &&
    value.targetKind !== "custom"
  ) {
    ctx.addIssue({
      code: "custom",
      message:
        "custom_coming_soon selectableReason only applies to custom entries",
      path: ["selectableReason"],
    });
  }
}

function validateLocalAgentCatalogSummary(
  value: LocalAgentCatalogSummaryValue,
  ctx: z.RefinementCtx
) {
  const builtinEntries = value.entries.filter(
    (entry) => entry.targetKind === "builtin"
  );
  const detectedSupported = builtinEntries.filter(
    (entry) => entry.detected && entry.launchStatus === "ready"
  ).length;
  const needsChoice = builtinEntries.filter(
    (entry) => entry.detected && entry.launchStatus === "needs_choice"
  ).length;
  const detectedNotSupportedYet = builtinEntries.filter(
    (entry) =>
      entry.detected &&
      entry.launchStatus === "not_available" &&
      entry.selectableReason === "not_supported_yet"
  ).length;
  const needsRepair = builtinEntries.filter(
    (entry) => entry.detected && entry.launchStatus === "needs_repair"
  ).length;
  const notDetected = builtinEntries.filter((entry) => !entry.detected).length;

  const expectations: Array<{
    actual: number;
    expected: number;
    label: string;
    path: string[];
  }> = [
    {
      actual: builtinEntries.length,
      expected: value.totalBuiltins,
      label: "totalBuiltins",
      path: ["totalBuiltins"],
    },
    {
      actual: detectedSupported,
      expected: value.detectedSupported,
      label: "detectedSupported",
      path: ["detectedSupported"],
    },
    {
      actual: needsChoice,
      expected: value.needsChoice,
      label: "needsChoice",
      path: ["needsChoice"],
    },
    {
      actual: detectedNotSupportedYet,
      expected: value.detectedNotSupportedYet,
      label: "detectedNotSupportedYet",
      path: ["detectedNotSupportedYet"],
    },
    {
      actual: needsRepair,
      expected: value.needsRepair,
      label: "needsRepair",
      path: ["needsRepair"],
    },
    {
      actual: notDetected,
      expected: value.notDetected,
      label: "notDetected",
      path: ["notDetected"],
    },
  ];

  for (const expectation of expectations) {
    if (expectation.actual === expectation.expected) {
      continue;
    }
    ctx.addIssue({
      code: "custom",
      message: `${expectation.label} must match the builtin entry summary`,
      path: expectation.path,
    });
  }
}
