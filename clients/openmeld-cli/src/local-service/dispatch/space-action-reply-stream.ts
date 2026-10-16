import { isDeepStrictEqual } from "node:util";
import { AGENT_STREAM_SNAPSHOT_MAX_CHARS } from "@openmeld/schemas";
import type { OpenMeldSpaceEgressAction } from "@openmeld/schemas/types";
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
}): { pause: () => void; resume: () => void; stop: () => void } {
  const context = input.context;
  if (!context) {
    return {
      pause: () => undefined,
      resume: () => undefined,
      stop: () => undefined,
    };
  }
  let previousAction: OpenMeldSpaceEgressAction | null | undefined;
  let previousConnection: unknown;
  let lastSentAtMs = 0;
  let sendErrorReported = false;
  const publishSnapshot = (
    text: string,
    placement?: "conversation" | "thread"
  ): boolean => {
    try {
      return input.publish(text, placement);
    } catch {
      // A socket can close between availability and send. Keep the durable
      // proposal pending; transport recovery owns reconnect diagnostics.
      if (!sendErrorReported) {
        sendErrorReported = true;
        input.onSendError?.();
      }
      return false;
    }
  };
  const tick = () => {
    const record = readDispatchSpaceActionRecord({ context });
    if (record.status === "invalid") {
      return;
    }
    const action =
      record.status === "loaded" && record.record.action.type === "post_message"
        ? record.record.action
        : null;
    // Reconsideration archives the prior action before running a repair turn.
    // Retract its draft immediately, including when the replacement is silence.
    if (!action && previousAction === undefined) {
      return;
    }
    const text =
      action?.messageEnvelope.text.slice(0, AGENT_STREAM_SNAPSHOT_MAX_CHARS) ??
      "";
    const actionChanged = !isDeepStrictEqual(action, previousAction);
    const connection = input.connection();
    if (
      !actionChanged &&
      connection === previousConnection &&
      Date.now() - lastSentAtMs < 5000
    ) {
      return;
    }
    const placement = actionChanged ? action?.placement : undefined;
    // Replays repair text delivery. Space owns the current editable location;
    // only a new public action may explicitly select it again.
    if (publishSnapshot(text, placement)) {
      sendErrorReported = false;
      previousAction = action;
      previousConnection = connection;
      // Socket send is not a Space acknowledgement. Periodic snapshots repair
      // a transient Core/Space write failure without changing the stream identity.
      lastSentAtMs = Date.now();
    }
  };
  let timer: ReturnType<typeof setInterval> | undefined = setInterval(
    tick,
    250
  );
  const pause = () => {
    clearInterval(timer);
    timer = undefined;
  };
  return {
    pause,
    resume: () => {
      if (timer === undefined) {
        timer = setInterval(tick, 250);
      }
    },
    stop: pause,
  };
}
