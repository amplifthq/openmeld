import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  type ServiceExecutionHostInput,
  type ServiceExecutionHostMethod,
  type ServiceExecutionHostOutput,
  serviceExecutionHostMethods,
} from "@openmeld/schemas";
import type {
  ExecutionHostEvent,
  ExecutionHostPort,
} from "../../src/local-service/execution-host/port";
import {
  createExecutionHostRuntime,
  type ExecutionHostResources,
} from "../../src/local-service/execution-host/runtime";
import type { Presenter } from "../../src/runtime/presenter/types";

// Real Host domain owners and a fake external adapter. Process isolation and
// authorization are covered separately by spawned-Host/production-entry tests.
export async function createInProcessExecutionHost(input: {
  stateRoot: string;
  daemonSessionId: string;
  deviceId: string;
  ownerUserId: string;
  profileOwnerName: string | null;
  resources: ExecutionHostResources;
  presenter: Presenter;
  serviceBundleId?: string | null;
}) {
  const listeners = new Set<(event: ExecutionHostEvent) => void>();
  const runtime = await createExecutionHostRuntime({
    resources: input.resources,
    hostInstanceId: randomUUID(),
    identity: {
      ownerUserId: input.ownerUserId,
      deviceId: input.deviceId,
      lane: "dev-local",
      daemonSessionId: input.daemonSessionId,
      serviceContractGeneration: 1,
      sessionIdentity: "isolated-host-fixture",
      stateRoot: input.stateRoot,
      authBaseUrl: "http://localhost:8080",
      gatewayBaseUrl: "http://localhost:8080",
      parentPid: process.pid,
      parentProcessStartedAt: "isolated-host-fixture",
    },
    runtimePaths: {
      contractMetaPath: join(input.stateRoot, "contract.json"),
      contractRepairReportPath: join(input.stateRoot, "repair.json"),
      contextStorePath: join(input.stateRoot, "contexts.json"),
      dataRootPath: input.stateRoot,
      deviceIdPath: join(input.stateRoot, "device.json"),
      ledgerRootPath: input.resources.ledgerPaths.rootDirPath,
    },
    serviceBundleId: input.serviceBundleId ?? null,
    profileOwnerName: input.profileOwnerName,
    presenter: input.presenter,
    emit: (event) => {
      for (const listener of listeners) {
        listener(event);
      }
    },
  });
  const port: ExecutionHostPort = {
    async call<M extends ServiceExecutionHostMethod>(
      method: M,
      payload: ServiceExecutionHostInput<M>
    ): Promise<ServiceExecutionHostOutput<M>> {
      const schema = serviceExecutionHostMethods[method];
      const parsed = schema.input.parse(payload);
      const handler = runtime.handlers[
        method as keyof typeof runtime.handlers
      ] as (value: unknown) => unknown;
      return schema.output.parse(
        await handler(parsed)
      ) as ServiceExecutionHostOutput<M>;
    },
    snapshot: runtime.snapshot,
    available: () => true,
    onEvent: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onAvailabilityChanged: () => () => undefined,
  };
  return { port, close: runtime.closeAfterConnectorLoss };
}
