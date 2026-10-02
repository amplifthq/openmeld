import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerFilesCommands } from "../src/files/command";

const copyToSpace = vi.fn();
const getFile = vi.fn();
const line = vi.fn();

vi.mock("@openmeld/api-client", () => ({
  createFileRootApi: () => ({ copyToSpace, getFile }),
}));
vi.mock("../src/config/auth-session", () => ({
  getAuthSessionState: async () => ({
    state: "valid",
    session: { activeOrganization: { id: "team-id" } },
  }),
}));
vi.mock("../src/config/base-url", () => ({
  resolveBaseUrl: async () => "https://example.invalid",
}));
vi.mock("../src/runtime/context", () => ({
  resolveRuntimeContext: async () => ({ view: "human" }),
}));
vi.mock("../src/runtime/presenter", () => ({
  createPresenter: () => ({ view: "human", line }),
}));
vi.mock("../src/space/api-client-foundation", () => ({
  createCliApiClientFoundation: () => ({}),
}));

describe("Files copy to Space command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getFile.mockResolvedValue({ name: "brief.md" });
    copyToSpace.mockResolvedValue({ id: "space-copy", path: "/brief.md" });
  });

  it("copies the selected source revision into the named Space", async () => {
    const program = new Command().name("openmeld");
    registerFilesCommands(program, async (_route, run) => run());

    await program.parseAsync(
      [
        "files",
        "copy-to-space",
        "source-file",
        "--source-location",
        "my",
        "--space",
        "space-id",
        "--revision",
        "3",
      ],
      { from: "user" }
    );

    expect(getFile).toHaveBeenCalledWith({
      location: "my",
      fileId: "source-file",
    });
    expect(copyToSpace).toHaveBeenCalledWith({
      spaceId: "space-id",
      body: {
        sourceLocation: "my",
        sourceFileId: "source-file",
        sourceRevision: 3,
        name: "brief.md",
        parentId: null,
        clientMutationId: expect.any(String),
      },
    });
    expect(line).toHaveBeenCalledWith(
      expect.objectContaining({ code: "files.copied_to_space" })
    );
  });
});
