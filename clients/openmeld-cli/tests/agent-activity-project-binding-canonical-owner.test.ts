import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveLocalProjectConnectionForPath } from "../src/agent-activity/project-binding-resolution";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map(async (root) => rm(root, { force: true, recursive: true }))
  );
});

describe("Agent Activity canonical Project ownership", () => {
  it("selects Project B when a path lexically inside Project A resolves into B", async () => {
    const root = await mkdtemp(join(tmpdir(), "openmeld-project-owner-"));
    temporaryRoots.push(root);
    const projectAPath = join(root, "project-a");
    const projectBPath = join(root, "project-b");
    const projectBSessionPath = join(projectBPath, "sessions", "session-1");
    await mkdir(projectAPath, { recursive: true });
    await mkdir(projectBSessionPath, { recursive: true });
    await symlink(projectBPath, join(projectAPath, "linked-project"), "dir");

    const projectA = {
      bindingGeneration: "binding-a",
      organizationId: "org-1",
      projectId: "project-a",
      repositoryPath: await realpath(projectAPath),
    };
    const projectB = {
      bindingGeneration: "binding-b",
      organizationId: "org-1",
      projectId: "project-b",
      repositoryPath: await realpath(projectBPath),
    };

    await expect(
      resolveLocalProjectConnectionForPath({
        connections: [projectA, projectB],
        organizationId: "org-1",
        path: join(projectAPath, "linked-project", "sessions", "session-1"),
      })
    ).resolves.toEqual(projectB);
  });
});
