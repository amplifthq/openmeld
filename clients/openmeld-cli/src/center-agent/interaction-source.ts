import { centerAgentInteractionSourceSchema } from "@openmeld/schemas";
import type { CenterAgentInteractionSource } from "@openmeld/schemas/types";
import { detectLocalAgentEnvironment } from "../space/local-agent-environment";

export function resolveCenterAgentLocalSource(input: {
  sessionId?: string;
  via?: string;
}): CenterAgentInteractionSource | null {
  const detectedSubject = detectLocalAgentEnvironment(process.env);
  let detectedClient: string | null = null;
  if (detectedSubject.kind === "agent") {
    detectedClient = detectedSubject.agentControllerRef.replace("builtin:", "");
  } else if (detectedSubject.kind === "codex_missing_thread") {
    detectedClient = "codex";
  }
  const explicitClient = String(input.via ?? "").trim();
  const client = explicitClient || detectedClient || "openmeld-cli";
  const detectedSessionId =
    detectedSubject.kind === "agent" &&
    (!explicitClient || explicitClient === detectedClient)
      ? detectedSubject.agentControllerConversationId
      : null;
  const sessionId =
    String(input.sessionId ?? "").trim() || detectedSessionId || null;
  const parsed = centerAgentInteractionSourceSchema.safeParse({
    client,
    kind: "local_agent",
    ...(sessionId ? { sessionId } : {}),
  });
  return parsed.success ? parsed.data : null;
}
