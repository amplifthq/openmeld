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
}): () => void {
  const context = input.context;
  if (!context) {
    return () => undefined;
  }
  let previousText: string | null = null;
  let previousPlacement: "conversation" | "thread" | undefined;
  let previousConnection: unknown;
  const tick = () => {
    const record = readDispatchSpaceActionRecord({ context });
    if (
      record.status !== "loaded" ||
      record.record.action.type !== "post_message"
    ) {
      return;
    }
    const text = record.record.action.messageEnvelope.text.slice(
      0,
      AGENT_STREAM_SNAPSHOT_MAX_CHARS
    );
    const connection = input.connection();
    const placement = record.record.action.placement;
    if (
      text === previousText &&
      placement === previousPlacement &&
      connection === previousConnection
    ) {
      return;
    }
    let sent = false;
    try {
      sent = input.publish(text, placement);
    } catch {
      // A socket can close between the availability check and send. Keep the
      // durable proposal pending; transport recovery owns reconnect diagnostics.
      return;
    }
    if (sent) {
      previousText = text;
      previousPlacement = placement;
      previousConnection = connection;
    }
  };
  const timer = setInterval(tick, 250);
  return () => clearInterval(timer);
}
