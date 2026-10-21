import type { tracing as workerTracing } from "cloudflare:workers";

type WorkerSpan = ReturnType<typeof workerTracing.startSpan>;

const untracedSpan: WorkerSpan = {
  isTraced: false,
  setAttribute() {
    return this;
  },
  setAttributes() {
    return this;
  },
  recordException: () => undefined,
  updateName() {
    return this;
  },
  setStatus() {
    return this;
  },
  end: () => undefined,
};

// Preserve the vendor callback, arguments, return value and thrown errors.
// These unit tests do not export telemetry.
export const tracing = {
  enterSpan<T, A extends unknown[]>(
    _name: string,
    callback: (span: WorkerSpan, ...args: A) => T,
    ...args: A
  ): T {
    return callback(untracedSpan, ...args);
  },
} satisfies Pick<typeof workerTracing, "enterSpan">;

export class WorkerEntrypoint<Env = unknown> {
  protected ctx: ExecutionContext;
  protected env: Env;

  constructor(ctx: ExecutionContext, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}
