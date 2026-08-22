import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveLocalProjectConnectionForPath } from "../src/agent-activity/project-binding-resolution";

const realpathMock = vi.hoisted(() => vi.fn());

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    realpath: realpathMock,
  };
});

const connection = {
  bindingGeneration: "binding-1",
  organizationId: "org-1",
  projectId: "project-1",
  repositoryPath: "/work/openmeld",
};

beforeEach(() => {
  realpathMock.mockReset();
});

describe("Agent Activity Project binding resolution", () => {
  it("fails closed when a Session path cannot be resolved", async () => {
    const missingPath = Object.assign(new Error("Path is unavailable."), {
      code: "ENOENT",
    });
    realpathMock.mockRejectedValue(missingPath);

    await expect(
      resolveLocalProjectConnectionForPath({
        connections: [connection],
        path: "/Volumes/offline/old-project",
      })
    ).resolves.toBeNull();
    expect(realpathMock).toHaveBeenCalledOnce();
  });

  it("matches a Project through an arbitrary symlink alias", async () => {
    realpathMock.mockResolvedValue("/work/openmeld/packages/web");

    await expect(
      resolveLocalProjectConnectionForPath({
        connections: [connection],
        path: "/Volumes/team-project/packages/web",
      })
    ).resolves.toEqual(connection);
    expect(realpathMock).toHaveBeenCalledWith(
      "/Volumes/team-project/packages/web"
    );
  });

  it("still canonicalizes a Session path inside an authorized Project", async () => {
    realpathMock.mockResolvedValue("/work/openmeld/packages/web");

    await expect(
      resolveLocalProjectConnectionForPath({
        connections: [connection],
        path: "/work/openmeld/packages/web",
      })
    ).resolves.toEqual(connection);
    expect(realpathMock).toHaveBeenCalledOnce();
  });

  it("recognizes the standard macOS private-path alias before canonicalizing", async () => {
    realpathMock.mockResolvedValue("/private/var/work/openmeld/packages/web");

    await expect(
      resolveLocalProjectConnectionForPath({
        connections: [
          {
            ...connection,
            repositoryPath: "/private/var/work/openmeld",
          },
        ],
        path: "/var/work/openmeld/packages/web",
      })
    ).resolves.toMatchObject({ projectId: "project-1" });
    expect(realpathMock).toHaveBeenCalledOnce();
  });
});
