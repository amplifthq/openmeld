import {
  type ServiceExecutionHostIdentity,
  serviceExecutionHostMethods,
} from "@openmeld/schemas";
import {
  type StoredAuthSession,
  withAdmittedServiceSession,
} from "../../config/auth-session";
import { resolveRuntimeContext } from "../../runtime/context";
import { createPresenter } from "../../runtime/presenter/index";
import { ensureDaemonRuntimePaths } from "../state/daemon-device-id";
import {
  ExecutionHostError,
  type ExecutionHostHandlers,
  serveExecutionHost,
} from "./channel";
import { validateExecutionHostIdentity } from "./identity";
import {
  acquireExecutionHostOwnership,
  readExecutionHostBootIdentity,
} from "./ownership";
import { parentExecutionHostChannel } from "./process-channel";

// This entry has no public listener and accepts no executable/path override.
// The inherited pipe, parent incarnation and current Service account are all
// required before the provider graph or any local runtime state is opened.
export function runExecutionHost(hostInstanceId: string): Promise<void> {
  const channel = parentExecutionHostChannel();
  const done = Promise.withResolvers<void>();
  let runtime: Awaited<
    ReturnType<typeof import("./runtime").createExecutionHostRuntime>
  > | null = null;
  let ownership: Awaited<
    ReturnType<typeof acquireExecutionHostOwnership>
  > | null = null;
  let session: StoredAuthSession | null = null;
  let acceptedIdentity: ServiceExecutionHostIdentity | null = null;
  let initializing: Promise<void> | null = null;
  let closing: Promise<void> | null = null;
  let disconnected = false;

  const close = (): Promise<void> => {
    if (!closing) {
      closing = (async () => {
        try {
          await initializing;
          if (runtime && session) {
            const currentRuntime = runtime;
            await withAdmittedServiceSession(session, () =>
              currentRuntime.closeAfterConnectorLoss()
            );
          }
        } finally {
          await ownership?.release();
          server.dispose();
          if (process.connected) {
            process.disconnect();
          }
        }
      })();
      closing.then(
        () => done.resolve(),
        (error) => done.reject(error)
      );
    }
    return closing;
  };

  const handlers = {
    initialize: async (identity: ServiceExecutionHostIdentity) => {
      if (
        acceptedIdentity &&
        JSON.stringify(acceptedIdentity) !== JSON.stringify(identity)
      ) {
        throw new ExecutionHostError(
          "host.identity_mismatch",
          "This Host is already assigned to a different Service incarnation."
        );
      }
      if (!initializing) {
        acceptedIdentity = identity;
        initializing = (async () => {
          const verified = await validateExecutionHostIdentity(identity);
          if (disconnected) {
            throw new ExecutionHostError(
              "host.disconnected",
              "The supervising Service left before Host initialization."
            );
          }
          const verifiedOwnership = await acquireExecutionHostOwnership({
            ...identity,
            hostInstanceId,
            bootIdentity: await readExecutionHostBootIdentity(),
          });
          ownership = verifiedOwnership;
          session = verified.session;
          await withAdmittedServiceSession(session, async () => {
            const { createExecutionHostRuntime, createExecutionHostResources } =
              await import("./runtime");
            const runtimePaths = await ensureDaemonRuntimePaths();
            const presenter = createPresenter(
              await resolveRuntimeContext({ view: "agent" })
            );
            runtime = await createExecutionHostRuntime({
              resources: await createExecutionHostResources({
                runtimePaths,
                presenter,
              }),
              hostInstanceId,
              identity,
              runtimePaths,
              serviceBundleId: verified.contract.bundleId,
              profileOwnerName: verified.session.user?.name ?? null,
              presenter,
              emit: (event) => {
                if (!disconnected) {
                  server.emit(event);
                }
              },
              onWorkStateChange: (quiescent) =>
                verifiedOwnership.observeLocalQuiescence(quiescent),
            });
          });
        })();
      }
      await initializing;
      if (!runtime || disconnected) {
        throw new ExecutionHostError(
          "host.disconnected",
          "The execution Host is not available."
        );
      }
      return runtime.snapshot();
    },
  } as ExecutionHostHandlers;

  // Each concrete method is still decoded by the shared method table at both
  // ends; the forwarding bridge cannot select a new account or mutate identity.
  for (const method of Object.keys(serviceExecutionHostMethods) as Array<
    keyof ExecutionHostHandlers
  >) {
    if (method === "initialize") {
      continue;
    }
    const target = handlers as unknown as Record<
      string,
      (payload: unknown) => Promise<unknown>
    >;
    target[method] = async (payload) => {
      if (!(runtime && session) || disconnected) {
        throw new ExecutionHostError(
          "host.not_initialized",
          "Initialize this Host through its supervising Service first."
        );
      }
      const invoke = runtime.handlers[method] as (value: unknown) => unknown;
      return await withAdmittedServiceSession(
        session,
        async () => await invoke(payload)
      );
    };
  }

  const server = serveExecutionHost({
    channel,
    hostInstanceId,
    handlers,
    onFailure: (error) => {
      console.error("[openmeld.execution_host.channel_failed]", error);
      disconnected = true;
      close().catch(() => undefined);
    },
    onDisconnect: () => {
      disconnected = true;
      close().catch(() => undefined);
    },
  });
  return done.promise;
}
