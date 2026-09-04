import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { touchDaemonCatalogSyncSignal } = vi.hoisted(() => ({
  touchDaemonCatalogSyncSignal: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/local-service/state/catalog-sync-signal", () => ({
  touchDaemonCatalogSyncSignal,
}));

import {
  bindProject,
  setDefaultProjectConnection,
} from "../src/agent-activity/project-bindings";

const temporaryRoots: string[] = [];

describe("Project binding route refresh signal", () => {
  beforeEach(() => {
    touchDaemonCatalogSyncSignal.mockClear();
  });

  afterEach(async () => {
    await Promise.all(
      temporaryRoots
        .splice(0)
        .map((path) => rm(path, { force: true, recursive: true }))
    );
  });

  it("signals every durable mutation once and keeps repeated no-op writes idempotent", async () => {
    const rootDir = await mkdtemp(
      join(tmpdir(), "openmeld-project-route-refresh-")
    );
    temporaryRoots.push(rootDir);
    const firstPath = join(rootDir, "first");
    const secondPath = join(rootDir, "second");
    await Promise.all([
      mkdir(firstPath, { recursive: true }),
      mkdir(secondPath, { recursive: true }),
    ]);

    const first = await bindProject({
      organizationId: "org-1",
      projectId: "project-1",
      projectSlug: "openmeld",
      repositoryFingerprint: null,
      repositoryPath: firstPath,
      rootDir,
    });
    await bindProject({
      organizationId: "org-1",
      projectId: "project-1",
      projectSlug: "openmeld",
      repositoryFingerprint: null,
      repositoryPath: firstPath,
      rootDir,
    });
    const second = await bindProject({
      organizationId: "org-1",
      projectId: "project-1",
      projectSlug: "openmeld",
      repositoryFingerprint: null,
      repositoryPath: secondPath,
      rootDir,
    });

    expect(first.isDefault).toBe(true);
    expect(second.isDefault).toBe(false);
    expect(touchDaemonCatalogSyncSignal).toHaveBeenCalledTimes(2);

    await setDefaultProjectConnection({
      expectedBindingGeneration: second.bindingGeneration,
      organizationId: "org-1",
      projectId: "project-1",
      rootDir,
    });
    await setDefaultProjectConnection({
      expectedBindingGeneration: second.bindingGeneration,
      organizationId: "org-1",
      projectId: "project-1",
      rootDir,
    });

    expect(touchDaemonCatalogSyncSignal).toHaveBeenCalledTimes(3);
    expect(touchDaemonCatalogSyncSignal).toHaveBeenLastCalledWith({
      reason: "project_connections_changed",
      rootDir,
    });
  });
});
