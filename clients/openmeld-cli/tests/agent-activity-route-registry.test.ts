import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bindProject } from "../src/agent-activity/project-bindings";
import {
  isAgentActivityRouteRegistered,
  registerAgentActivityRoute,
  resolveAgentActivityRouteForPath,
  unregisterAgentActivityRoute,
} from "../src/agent-activity/route-registry";

let root: string | null = null;

afterEach(async () => {
  if (root) {
    await rm(root, { force: true, recursive: true });
    root = null;
  }
});

describe("Agent Activity route registry", () => {
  it("routes each repository to its exact OpenMeld lane, including a custom home", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-activity-routes-"));
    const globalRootDir = join(root, "global");
    const devRootDir = join(root, ".openmeld-dev");
    const customRootDir = join(root, "custom-home");
    const devRepository = join(root, "dev-repository");
    const customRepository = join(root, "custom-repository");
    await Promise.all([
      mkdir(join(devRepository, "src"), { recursive: true }),
      mkdir(customRepository, { recursive: true }),
    ]);

    await bindProject({
      organizationId: "org-dev",
      projectId: "project-dev",
      projectSlug: "dev-project",
      repositoryFingerprint: null,
      repositoryPath: devRepository,
      rootDir: devRootDir,
    });
    await bindProject({
      organizationId: "org-custom",
      projectId: "project-custom",
      projectSlug: "custom-project",
      repositoryFingerprint: null,
      repositoryPath: customRepository,
      rootDir: customRootDir,
    });
    await registerAgentActivityRoute({ globalRootDir, rootDir: devRootDir });
    await registerAgentActivityRoute({ globalRootDir, rootDir: customRootDir });

    await expect(
      resolveAgentActivityRouteForPath({
        globalRootDir,
        path: join(devRepository, "src"),
      })
    ).resolves.toEqual({ rootDir: await realpath(devRootDir) });
    await expect(
      resolveAgentActivityRouteForPath({
        globalRootDir,
        path: customRepository,
      })
    ).resolves.toEqual({ rootDir: await realpath(customRootDir) });
  });

  it("fails closed when two lanes bind the same repository", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-activity-routes-"));
    const globalRootDir = join(root, "global");
    const repositoryPath = join(root, "repository");
    const firstRootDir = join(root, "first-home");
    const secondRootDir = join(root, "second-home");
    await mkdir(repositoryPath, { recursive: true });

    for (const [index, rootDir] of [firstRootDir, secondRootDir].entries()) {
      await bindProject({
        organizationId: `org-${index}`,
        projectId: `project-${index}`,
        projectSlug: `project-${index}`,
        repositoryFingerprint: null,
        repositoryPath,
        rootDir,
      });
      await registerAgentActivityRoute({ globalRootDir, rootDir });
    }

    await expect(
      resolveAgentActivityRouteForPath({ globalRootDir, path: repositoryPath })
    ).rejects.toThrow(
      "Repository is bound in more than one OpenMeld lane; Agent Activity routing is disabled until the duplicate binding is removed."
    );
  });

  it("removes only the selected lane from the global registry", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-activity-routes-"));
    const globalRootDir = join(root, "global");
    const firstRootDir = join(root, "first-home");
    const secondRootDir = join(root, "second-home");
    await Promise.all([
      mkdir(firstRootDir, { recursive: true }),
      mkdir(secondRootDir, { recursive: true }),
    ]);
    await registerAgentActivityRoute({ globalRootDir, rootDir: firstRootDir });
    await registerAgentActivityRoute({ globalRootDir, rootDir: secondRootDir });

    await expect(
      unregisterAgentActivityRoute({ globalRootDir, rootDir: firstRootDir })
    ).resolves.toEqual({ remainingRouteCount: 1, removed: true });
    await expect(
      isAgentActivityRouteRegistered({
        globalRootDir,
        rootDir: firstRootDir,
      })
    ).resolves.toBe(false);
    await expect(
      isAgentActivityRouteRegistered({
        globalRootDir,
        rootDir: secondRootDir,
      })
    ).resolves.toBe(true);
  });

  it("can register and inspect a fresh lane before its root directory exists", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-activity-routes-"));
    const globalRootDir = join(root, "global");
    const freshRootDir = join(root, "fresh-home");

    await expect(
      registerAgentActivityRoute({ globalRootDir, rootDir: freshRootDir })
    ).resolves.toBeUndefined();
    await expect(
      isAgentActivityRouteRegistered({
        globalRootDir,
        rootDir: freshRootDir,
      })
    ).resolves.toBe(true);
    await expect(
      unregisterAgentActivityRoute({
        globalRootDir,
        rootDir: freshRootDir,
      })
    ).resolves.toEqual({ remainingRouteCount: 0, removed: true });
  });

  it("holds the registry lock while the last route removes shared integrations", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-activity-routes-"));
    const globalRootDir = join(root, "global");
    const firstRootDir = join(root, "first-home");
    const secondRootDir = join(root, "second-home");
    await Promise.all([
      mkdir(firstRootDir, { recursive: true }),
      mkdir(secondRootDir, { recursive: true }),
    ]);
    await registerAgentActivityRoute({ globalRootDir, rootDir: firstRootDir });

    const order: string[] = [];
    let releaseCleanup: (() => void) | undefined;
    const cleanupMayFinish = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    let markCleanupStarted: (() => void) | undefined;
    const cleanupStarted = new Promise<void>((resolve) => {
      markCleanupStarted = resolve;
    });
    const unregistering = unregisterAgentActivityRoute({
      globalRootDir,
      onNoRemainingRoutes: async () => {
        markCleanupStarted?.();
        expect(
          await isAgentActivityRouteRegistered({
            globalRootDir,
            rootDir: firstRootDir,
          })
        ).toBe(false);
        order.push("cleanup-started");
        await cleanupMayFinish;
        order.push("cleanup-finished");
      },
      rootDir: firstRootDir,
    });
    await cleanupStarted;
    const registering = registerAgentActivityRoute({
      globalRootDir,
      rootDir: secondRootDir,
    }).then(() => {
      order.push("registration-finished");
    });

    releaseCleanup?.();
    await Promise.all([unregistering, registering]);
    expect(order).toEqual([
      "cleanup-started",
      "cleanup-finished",
      "registration-finished",
    ]);
  });
});
