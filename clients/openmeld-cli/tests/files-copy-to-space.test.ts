import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerFilesCommands } from "../src/files/command";

const copyToSpace = vi.fn();
const getFile = vi.fn();
const streamContent = vi.fn();
const line = vi.fn();

vi.mock("@openmeld/api-client", () => ({
  createFileRootApi: () => ({ copyToSpace, getFile, streamContent }),
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

describe("Files commands", () => {
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

  it("reads an existing generic-type patch through the command and rejects binary or oversized content", async () => {
    const patch = "--- a/file\n+++ b/file\n-old\n+new ✓\n";
    getFile.mockResolvedValue({ name: "review.patch" });
    const read = (bytes: Uint8Array, sizeBytes = bytes.byteLength) => {
      const cancel = vi.fn();
      const response = {
        bytes: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
          cancel,
        }),
        mimeType: "application/octet-stream",
        revision: 3,
        sizeBytes,
      } satisfies Awaited<
        ReturnType<
          ReturnType<
            typeof import("@openmeld/api-client").createFileRootApi
          >["streamContent"]
        >
      >;
      streamContent.mockResolvedValue(response);
      const program = new Command().name("openmeld");
      registerFilesCommands(program, async (_route, run) => run());
      const result = program.parseAsync(
        [
          "files",
          "read",
          "source-file",
          "--location",
          "team",
          "--revision",
          "3",
        ],
        { from: "user" }
      );
      return { result, cancel };
    };
    await read(new TextEncoder().encode(patch)).result;
    expect(line).toHaveBeenCalledWith({ code: "files.read", text: patch });
    await expect(read(new Uint8Array([0x66, 0x00])).result).rejects.toThrow();
    const oversized = read(new Uint8Array([0x61]), 1024 * 1024 + 1);
    await expect(oversized.result).rejects.toThrow("too large");
    expect(oversized.cancel).toHaveBeenCalledOnce();
  });
});
