import type { FlueObservation } from "@flue/runtime";
import type { AgentStreamToolPart } from "@openmeld/schemas/types";
import { resolveRemoteAgentToolWorkActivity } from "./tool-work-activity";

export type FlueStreamDelta = {
  delta: string;
  kind: "text" | "thinking";
  observedAtMs: number;
  submissionId: string;
};

export type FlueToolLifecyclePart = {
  observedAtMs: number;
  organizationSkillName?: string;
  part: AgentStreamToolPart;
  submissionId: string;
};

export function extractFlueToolLifecyclePart(
  event: FlueObservation
): FlueToolLifecyclePart | null {
  if (
    (event.type !== "tool_start" && event.type !== "tool") ||
    typeof event.submissionId !== "string" ||
    event.submissionId.trim().length === 0
  ) {
    return null;
  }
  const observedAtMs = Date.parse(event.timestamp);
  const work = resolveRemoteAgentToolWorkActivity(event.toolName, event.args);
  return {
    observedAtMs: Number.isFinite(observedAtMs) ? observedAtMs : Date.now(),
    ...readActivatedOrganizationSkillName(event),
    submissionId: event.submissionId,
    part: {
      type: "tool",
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      state: resolveFlueToolPartState(event),
      ...(work ? { work } : {}),
    },
  };
}

function readActivatedOrganizationSkillName(
  event: Extract<FlueObservation, { type: "tool" | "tool_start" }>
): { organizationSkillName: string } | Record<string, never> {
  if (
    event.toolName !== "activate_skill" ||
    !event.args ||
    typeof event.args !== "object"
  ) {
    return {};
  }
  const name = (event.args as { name?: unknown }).name;
  if (typeof name !== "string" || name.trim().length === 0) {
    return {};
  }
  return { organizationSkillName: name.trim() };
}

function resolveFlueToolPartState(
  event: Extract<FlueObservation, { type: "tool" | "tool_start" }>
): AgentStreamToolPart["state"] {
  if (event.type === "tool_start") {
    return "input-available";
  }
  return event.isError ? "output-error" : "output-available";
}

export function extractFlueStreamDelta(
  event: FlueObservation
): FlueStreamDelta | null {
  const delta = readFlueStreamDelta(event);
  if (
    delta === null ||
    typeof event.submissionId !== "string" ||
    event.submissionId.trim().length === 0 ||
    delta.length === 0
  ) {
    return null;
  }

  const observedAtMs = Date.parse(event.timestamp);
  return {
    delta,
    kind: event.type === "thinking_delta" ? "thinking" : "text",
    observedAtMs: Number.isFinite(observedAtMs) ? observedAtMs : Date.now(),
    submissionId: event.submissionId,
  };
}

function readFlueStreamDelta(event: FlueObservation): string | null {
  if (event.type === "text_delta") {
    return event.text;
  }
  if (event.type === "thinking_delta") {
    return event.delta;
  }
  return null;
}

export function extractAssistantText(event: FlueObservation): string {
  const output = event.agentOutput;
  if (output?.type === "text") {
    return output.text.trim();
  }
  const result = (event as { result?: { text?: unknown } }).result;
  return typeof result?.text === "string" ? result.text.trim() : "";
}

export function extractModelId(event: FlueObservation): string | null {
  const result = (
    event as { result?: { model?: { id?: unknown; provider?: unknown } } }
  ).result;
  const provider =
    typeof result?.model?.provider === "string" ? result.model.provider : null;
  const id = typeof result?.model?.id === "string" ? result.model.id : null;
  return provider && id ? `${provider}/${id}` : id;
}
