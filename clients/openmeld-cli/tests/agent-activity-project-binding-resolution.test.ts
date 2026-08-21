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
  it("does not access the filesystem for a Session outside every authorized Project", async () => {
    realpathMock.mockRejectedValue(
      new Error("Unrelated historical Session paths must not be inspected.")
    );

    await expect(
      resolveLocalProjectConnectionForPath({
        connections: [connection],
        path: "/Volumes/offline/old-project",
      })
    ).resolves.toBeNull();
    expect(realpathMock).not.toHaveBeenCalled();
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
