import { z } from "zod/v4";

export const STRUCTURED_GUIDE_SCHEMA_VERSION = 1 as const;

export const dualViewGuideInputSchema = z.strictObject({
  summary: z.string().min(1),
  humanSteps: z.array(z.string()),
  agentRequiredArgs: z.array(z.string()).optional(),
  agentOptionalArgs: z.array(z.string()).optional(),
  agentCommands: z.array(z.string()).optional(),
  notes: z.array(z.string()).optional(),
});

export const structuredGuidePayloadSchema = z.strictObject({
  schemaVersion: z.literal(STRUCTURED_GUIDE_SCHEMA_VERSION),
  summary: z.string().min(1),
  forAgents: z.strictObject({
    requiredArguments: z.array(z.string()),
    optionalArguments: z.array(z.string()),
    commands: z.array(z.string()),
    notes: z.array(z.string()),
  }),
  forHumans: z.strictObject({
    steps: z.array(z.string()),
  }),
});

/**
 * Builds a stable structured payload:
 * optional agent arrays are normalized to `[]`, and schemaVersion is always present.
 */
export const structuredGuidePayloadFromInputSchema = dualViewGuideInputSchema
  .transform((guide) => ({
    schemaVersion: STRUCTURED_GUIDE_SCHEMA_VERSION,
    summary: guide.summary,
    forAgents: {
      requiredArguments: guide.agentRequiredArgs ?? [],
      optionalArguments: guide.agentOptionalArgs ?? [],
      commands: guide.agentCommands ?? [],
      notes: guide.notes ?? [],
    },
    forHumans: {
      steps: guide.humanSteps,
    },
  }))
  .pipe(structuredGuidePayloadSchema);
