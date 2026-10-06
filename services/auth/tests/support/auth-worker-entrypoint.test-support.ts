import type { AuthBindings } from "../../src/lib/bindings";
import { AuthRpcEntrypoint } from "../../src/lib/rpc/entrypoint";

/** HTTP behavior tests use the same request owner as the deployed Worker. */
export function createAuthWorkerTestApp() {
  return {
    fetch(
      request: Request,
      env: AuthBindings,
      context: ExecutionContext
    ): Promise<Response> {
      return new AuthRpcEntrypoint(context, env).fetch(request);
    },
  };
}
