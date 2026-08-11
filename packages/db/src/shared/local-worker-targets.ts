import path from "node:path";
import { D1_LOCAL_DB_PATH_ENV_NAME } from "../auth/fact-metadata.ts";
import { getRepoRootDirectoryPath } from "../auth/paths.ts";
import {
  getSharedLocalDevWranglerStateDirectoryPath,
  resolveSharedLocalWranglerSqlitePath,
  resolveWranglerD1BindingMetadata,
} from "../tooling/wrangler-d1-target.ts";
import { SHARED_DB_BINDING_NAME } from "./fact-metadata.ts";

export type SharedLocalWorkerDbTarget = {
  databaseId: string | null;
  databaseName: string | null;
  localPath: string;
  service: "auth" | "core";
  targetLabel: string;
  wranglerConfigAbsolutePath: string;
};

export type SharedLocalWorkerDbTargetDescriptor = Omit<
  SharedLocalWorkerDbTarget,
  "localPath"
>;

const resolveAuthWranglerConfigAbsolutePath = (): string => {
  return path.resolve(
    getRepoRootDirectoryPath(),
    "services/auth/wrangler.jsonc"
  );
};

const resolveCoreWranglerConfigAbsolutePath = (): string => {
  return path.resolve(
    getRepoRootDirectoryPath(),
    "services/core/wrangler.jsonc"
  );
};

const resolveExplicitSharedLocalDbPath = (): string | null => {
  const explicitPath = String(
    process.env[D1_LOCAL_DB_PATH_ENV_NAME] ?? ""
  ).trim();
  return explicitPath.length > 0 ? path.resolve(explicitPath) : null;
};

/**
 * Resolves the physical sqlite path for the shared local OPENMELD_DB. Auth and
 * Core run in one Miniflare instance persisted at the shared
 * `.wrangler-dev-state` root, so every worker target resolves to the same
 * sqlite file the dev worker actually reads. `D1_LOCAL_DB_PATH` still overrides
 * for bespoke inspection.
 */
export const resolveSharedLocalWorkerDbTargetLocalPath = (): string => {
  return (
    resolveExplicitSharedLocalDbPath() ??
    resolveSharedLocalWranglerSqlitePath(
      getSharedLocalDevWranglerStateDirectoryPath()
    )
  );
};

const SHARED_LOCAL_WORKER_TARGETS: readonly Pick<
  SharedLocalWorkerDbTargetDescriptor,
  "service" | "targetLabel" | "wranglerConfigAbsolutePath"
>[] = [
  {
    service: "auth",
    wranglerConfigAbsolutePath: resolveAuthWranglerConfigAbsolutePath(),
    targetLabel: "auth local OPENMELD_DB",
  },
  {
    service: "core",
    wranglerConfigAbsolutePath: resolveCoreWranglerConfigAbsolutePath(),
    targetLabel: "core local OPENMELD_DB",
  },
] as const;

export const listSharedLocalWorkerDbTargetDescriptors =
  (): SharedLocalWorkerDbTargetDescriptor[] => {
    return SHARED_LOCAL_WORKER_TARGETS.map((target) => {
      const bindingMetadata = resolveWranglerD1BindingMetadata({
        bindingName: SHARED_DB_BINDING_NAME,
        mode: "dev",
        wranglerConfigAbsolutePath: target.wranglerConfigAbsolutePath,
      });

      return {
        ...target,
        databaseId: bindingMetadata.databaseId,
        databaseName: bindingMetadata.databaseName,
      };
    });
  };

export const listSharedLocalWorkerDbTargets =
  (): SharedLocalWorkerDbTarget[] => {
    return listSharedLocalWorkerDbTargetDescriptors().map((target) => {
      return {
        ...target,
        localPath: resolveSharedLocalWorkerDbTargetLocalPath(),
      };
    });
  };
