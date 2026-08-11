import {
  createCoreRpcHttpError,
  isRpcReceiverMethodNotImplementedError,
} from "./errors";

export async function callRequiredAuthWorkerRpc<
  TBinding extends object,
  TResult,
>(input: {
  authWorker: TBinding | undefined;
  call: (authWorker: Required<TBinding>) => Promise<TResult>;
  unavailable: { code: string; reason: string };
}): Promise<TResult> {
  const createUnavailableError = (): Error =>
    createCoreRpcHttpError({
      status: 503,
      reason: input.unavailable.reason,
      code: input.unavailable.code,
    });
  if (!input.authWorker) {
    throw createUnavailableError();
  }

  try {
    // Service-binding RPC stubs are Proxies that synthesize every method
    // property, so only invocation can detect an older receiver contract.
    return await input.call(input.authWorker as Required<TBinding>);
  } catch (error) {
    if (!isRpcReceiverMethodNotImplementedError(error)) {
      throw error;
    }
    throw createUnavailableError();
  }
}
