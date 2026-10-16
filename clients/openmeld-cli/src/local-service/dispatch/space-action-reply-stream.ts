import { AGENT_STREAM_SNAPSHOT_MAX_CHARS } from "@openmeld/schemas";
import {
  type DispatchSpaceActionContext,
  readDispatchSpaceActionRecord,
} from "../../runtime/dispatch-space-action-context";

// Both native tools and the CLI persist through the same record writer. Watch
// that durable boundary, never the controller's private assistant output.
export function watchSpaceActionReply(input: {
  context: DispatchSpaceActionContext | null;
  publish: (text: string, placement?: "conversation" | "thread") => boolean;
  connection: () => unknown;
  onSendError?: () => void;
}): () => void {
  const context = input.context;
  if (!context) {
    return () => undefined;
  }
  let previousText: string | null = null;
  let previousPlacement: "conversation" | "thread" | undefined;
  let previousConnection: unknown;
  let lastSentAtMs = 0;
  let sendErrorReported = false;
  const tick = () => {
    const record = readDispatchSpaceActionRecord({ context });
    if (record.status === "invalid") {
      return;
    }
    const action = record.status === "loaded" ? record.record.action : null;
    // Reconsideration archives the prior action before running a repair turn.
    // Retract its draft immediately, including when the replacement is silence.
    let text = "";
    let placement = previousPlacement;
    if (action?.type === "post_message") {
      text = action.messageEnvelope.text.slice(
        0,
        AGENT_STREAM_SNAPSHOT_MAX_CHARS
      );
      placement = action.placement;
    } else if (previousText === null) {
      return;
    }
    const connection = input.connection();
    if (
      text === previousText &&
      placement === previousPlacement &&
      connection === previousConnection &&
      Date.now() - lastSentAtMs < 5000
    ) {
      return;
    }
    let sent = false;
    try {
      sent = input.publish(text, placement);
    } catch {
      // A socket can close between the availability check and send. Keep the
      // durable proposal pending; transport recovery owns reconnect diagnostics.
      if (!sendErrorReported) {
        sendErrorReported = true;
        input.onSendError?.();
      }
      return;
    }
    if (sent) {
      sendErrorReported = false;
      previousText = text;
      previousPlacement = placement;
      previousConnection = connection;
      // Socket send is not a Space acknowledgement. Periodic snapshots repair
      // a transient Core/Space write failure without changing the stream identity.
      lastSentAtMs = Date.now();
    }
  };
  const timer = setInterval(tick, 250);
  return () => clearInterval(timer);
}
