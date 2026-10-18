/**
 * Authorized live delivery for one Space Durable Object.
 *
 * Every delivered message is preceded by an access check that started after
 * the message was queued, so a live connection is never a permanent access
 * grant. Each session drains its own queue: one check covers every message
 * that was already waiting, a slow check delays only its own session, and an
 * access check that cannot reach its evidence closes only that session.
 */

/**
 * The verified answer of one live access check. An access check that cannot
 * verify access throws instead; that is not a revocation.
 */
export type SpaceLiveAccessDecision = "authorized" | "denied";

export type SpaceLiveDeliveryTarget<TSession extends object> = {
  session: TSession;
  webSocket: WebSocket;
};

export type SpaceLiveDeliveryDependencies<TSession extends object, TMessage> = {
  /** Rechecks current access. Throws when access cannot be verified. */
  authorize: (session: TSession) => Promise<SpaceLiveAccessDecision>;
  /** Sends messages to a session whose access was just verified. */
  deliver: (
    target: SpaceLiveDeliveryTarget<TSession>,
    messages: readonly TMessage[]
  ) => void;
  /** False after the session quit or its socket got another session. */
  isActive: (target: SpaceLiveDeliveryTarget<TSession>) => boolean;
  /** Closes a session whose access check failed or was denied. */
  close: (
    target: SpaceLiveDeliveryTarget<TSession>,
    closure: SpaceLiveDeliveryClosure
  ) => void;
  waitUntil?: (promise: Promise<void>) => void;
};

export type SpaceLiveDeliveryClosure =
  | {
      /** Current access was denied: revoke the live connection. */
      code: 1008;
      reason: "space_access_changed";
    }
  | {
      /**
       * Access could not be verified twice. Messages are withheld, and the
       * client reconnects through the full join check and snapshot read,
       * which recovers what this session missed.
       */
      code: 1013;
      reason: "space_access_unverified";
      error: unknown;
    }
  | {
      code: 1011;
      reason: "live_delivery_failed";
      error: unknown;
    };

type SessionQueue<TSession extends object, TMessage> = {
  target: SpaceLiveDeliveryTarget<TSession>;
  pending: TMessage[];
};

export class SpaceLiveDelivery<TSession extends object, TMessage> {
  private readonly queues = new WeakMap<
    TSession,
    SessionQueue<TSession, TMessage>
  >();
  private readonly dependencies: SpaceLiveDeliveryDependencies<
    TSession,
    TMessage
  >;

  constructor(dependencies: SpaceLiveDeliveryDependencies<TSession, TMessage>) {
    this.dependencies = dependencies;
  }

  enqueue(
    targets: Iterable<SpaceLiveDeliveryTarget<TSession>>,
    message: TMessage
  ): void {
    for (const target of targets) {
      const queue = this.queues.get(target.session);
      if (queue) {
        queue.target = target;
        queue.pending.push(message);
        continue;
      }
      const created: SessionQueue<TSession, TMessage> = {
        target,
        pending: [message],
      };
      this.queues.set(target.session, created);
      const drain = this.drain(created);
      this.dependencies.waitUntil?.(drain);
    }
  }

  private async drain(queue: SessionQueue<TSession, TMessage>): Promise<void> {
    try {
      while (queue.pending.length > 0) {
        // Take the batch before the check starts so the check is never older
        // than any message it authorizes.
        const batch = queue.pending.splice(0);
        let decision: SpaceLiveAccessDecision;
        try {
          decision = await this.dependencies.authorize(queue.target.session);
        } catch {
          // Retry at once, on the rejected check's own continuation. A timer
          // would not keep a hibernating Space awake (waitUntil does not
          // extend a Durable Object's lifetime), so a delayed retry could be
          // discarded with the queue, leaving the socket open and the
          // withheld messages lost.
          batch.push(...queue.pending.splice(0));
          try {
            decision = await this.dependencies.authorize(queue.target.session);
          } catch (error) {
            this.closeQueue(queue, {
              code: 1013,
              reason: "space_access_unverified",
              error,
            });
            return;
          }
        }
        if (decision === "denied") {
          this.closeQueue(queue, {
            code: 1008,
            reason: "space_access_changed",
          });
          return;
        }
        if (!this.dependencies.isActive(queue.target)) {
          queue.pending.length = 0;
          return;
        }
        this.dependencies.deliver(queue.target, batch);
      }
    } catch (error) {
      this.closeQueue(queue, {
        code: 1011,
        reason: "live_delivery_failed",
        error,
      });
    } finally {
      this.queues.delete(queue.target.session);
    }
  }

  private closeQueue(
    queue: SessionQueue<TSession, TMessage>,
    closure: SpaceLiveDeliveryClosure
  ): void {
    queue.pending.length = 0;
    if (this.dependencies.isActive(queue.target)) {
      this.dependencies.close(queue.target, closure);
    }
  }
}
