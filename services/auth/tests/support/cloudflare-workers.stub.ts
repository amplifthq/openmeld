export class WorkerEntrypoint<Env = unknown> {
  protected ctx: ExecutionContext;
  protected env: Env;

  constructor(ctx: ExecutionContext, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}

// Workers tracing runs the callback inside a span; tests only need the call.
export const tracing = {
  enterSpan<T>(_name: string, callback: (span: unknown) => T): T {
    return callback({ setAttribute: () => undefined });
  },
};
