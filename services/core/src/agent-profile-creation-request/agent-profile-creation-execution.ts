import { agentProfileCreationExecutionMessageSchema } from "@openmeld/schemas";
import type { CoreBindings } from "../lib/bindings";

export async function scheduleAgentProfileCreation(
  env: CoreBindings,
  request: { id: string; organizationId: string }
): Promise<void> {
  if (!env.OPENMELD_DAEMON_DISPATCH_QUEUE) {
    throw new Error("Agent creation execution delivery is unavailable.");
  }
  await env.OPENMELD_DAEMON_DISPATCH_QUEUE.send({
    kind: "agent_profile_creation",
    v: 1,
    organizationId: request.organizationId,
    requestId: request.id,
  });
}

export async function handleAgentProfileCreationMessage(input: {
  env: CoreBindings;
  message: Message<unknown>;
}): Promise<boolean> {
  const body = input.message.body;
  if (
    !body ||
    typeof body !== "object" ||
    !("kind" in body) ||
    body.kind !== "agent_profile_creation"
  ) {
    return false;
  }
  const parsed = agentProfileCreationExecutionMessageSchema.safeParse(body);
  if (!parsed.success) {
    console.error("[core.agent_profile_creation_request.invalid_delivery]", {
      messageId: input.message.id,
    });
    input.message.ack();
    return true;
  }
  try {
    const { executeAgentProfileCreationRequest } = await import(
      "./agent-profile-creation-request-rpc"
    );
    await executeAgentProfileCreationRequest(input.env, {
      id: parsed.data.requestId,
      organizationId: parsed.data.organizationId,
    });
    input.message.ack();
  } catch (error) {
    console.error("[core.agent_profile_creation_request.delivery_failed]", {
      requestId: parsed.data.requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    input.message.retry({ delaySeconds: 30 });
  }
  return true;
}
