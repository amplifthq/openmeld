import * as z from "zod/v4";

export const AGENT_CONTEXT_ENVELOPE_VERSION = "agent_context.v1" as const;

export const AGENT_CONTEXT_PROGRESSIVE_POLICY_VERSION =
  "progressive_context.v1" as const;

const agentContextLineSchema = z.string().trim().min(1).max(4000);

export const agentContextEnvelopeSchema = z.strictObject({
  action: z.array(agentContextLineSchema).min(1),
  environment: z.array(agentContextLineSchema).min(1),
  rules: z.array(agentContextLineSchema).optional(),
  task: z.array(agentContextLineSchema).min(1),
  v: z
    .literal(AGENT_CONTEXT_ENVELOPE_VERSION)
    .default(AGENT_CONTEXT_ENVELOPE_VERSION),
});

export type AgentContextEnvelope = z.infer<typeof agentContextEnvelopeSchema>;

export function renderAgentContextEnvelope(
  envelopeInput: z.input<typeof agentContextEnvelopeSchema>
): string {
  const envelope = agentContextEnvelopeSchema.parse(envelopeInput);
  return [
    `[Agent Context Envelope: ${envelope.v}]`,
    ...renderSection("Task", envelope.task),
    ...renderSection("Environment", envelope.environment),
    ...renderSection("Rules", [
      `Context policy: ${AGENT_CONTEXT_PROGRESSIVE_POLICY_VERSION}.`,
      ...(envelope.rules ?? []),
    ]),
    ...renderSection("Action", envelope.action),
  ].join("\n");
}

function renderSection(label: string, lines: readonly string[]): string[] {
  return [`[${label}]`, ...lines.map((line) => `- ${line}`)];
}
