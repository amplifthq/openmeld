import { tracing } from "cloudflare:workers";
import { CORE_LOG_EVENTS } from "../../../shared/observability/log-events";

// The native gate can reset the instance at 30s, without running finally.
// Take a snapshot during the wait and another before that deadline.
const SLOW_GATE_MS = 5000;
const NEAR_RESET_MS = 25_000;

export class SpaceInputGateObservation {
  readonly id = crypto.randomUUID();
  active = true;
  private readonly startedAt = performance.now();
  private readonly pending = new Map<string, number>();
  private slow = false;
  private phase: "callback" | "postgres_cleanup" = "callback";
  private persistedSignalId?: string;
  private expectedClientMessageId?: string;
  private requestId?: string;
  private readonly durableObjectId: string;
  private readonly operation: string;
  private readonly parentGateId?: string;

  constructor(
    durableObjectId: string,
    operation: string,
    parentGateId?: string
  ) {
    this.durableObjectId = durableObjectId;
    this.operation = operation;
    this.parentGateId = parentGateId;
  }

  async observe<T>(run: () => Promise<T>): Promise<T> {
    const warn = () => {
      this.slow = true;
      this.emit("pending");
    };
    const slowTimer = setTimeout(warn, SLOW_GATE_MS);
    const resetTimer = setTimeout(warn, NEAR_RESET_MS);
    let status: "completed" | "failed" = "failed";
    try {
      const value = await run();
      status = "completed";
      return value;
    } finally {
      this.active = false;
      clearTimeout(slowTimer);
      clearTimeout(resetTimer);
      if (this.slow || performance.now() - this.startedAt >= SLOW_GATE_MS) {
        this.emit(status);
      }
    }
  }

  async during<T>(stage: string, work: () => Promise<T>): Promise<T> {
    this.pending.set(stage, (this.pending.get(stage) ?? 0) + 1);
    try {
      return await work();
    } finally {
      const count = this.pending.get(stage) ?? 1;
      if (count === 1) {
        this.pending.delete(stage);
      } else {
        this.pending.set(stage, count - 1);
      }
    }
  }

  watchMessage(clientMessageId: string, requestId?: string): void {
    this.expectedClientMessageId = clientMessageId;
    this.requestId = requestId;
  }

  stored(signalId: string, clientMessageId: string | undefined): void {
    if (clientMessageId && clientMessageId === this.expectedClientMessageId) {
      this.persistedSignalId = signalId;
    }
  }

  cleaningUp(): void {
    this.phase = "postgres_cleanup";
  }

  private emit(status: "pending" | "completed" | "failed"): void {
    console.warn("[core.space.input_gate]", {
      event: CORE_LOG_EVENTS.spaceInputGate,
      durableObjectId: this.durableObjectId,
      gateId: this.id,
      parentGateId: this.parentGateId,
      operation: this.operation,
      requestId: this.requestId,
      status,
      phase: this.phase,
      elapsedMs: Math.round(performance.now() - this.startedAt),
      pendingStages: Object.fromEntries(this.pending),
      persistedSignalId: this.persistedSignalId,
    });
  }
}

export function duringSpaceGateStage<T>(
  gate: SpaceInputGateObservation | undefined,
  stage: string,
  work: () => Promise<T>
): Promise<T> {
  if (!gate?.active) {
    return work();
  }
  return tracing.enterSpan(`space.input_gate_step.${stage}`, (span) => {
    span.setAttribute("openmeld.gate_id", gate.id);
    return gate.during(stage, work);
  });
}
