import { describe, expect, it, vi } from "vitest";
import { resolveSpaceSendText } from "../src/space/send-input";

describe("space send input resolver", () => {
  it("uses positional text when provided", async () => {
    await expect(
      resolveSpaceSendText({
        text: "hello world",
      })
    ).resolves.toBe("hello world");
  });

  it("keeps shell-sensitive characters unchanged for positional text", async () => {
    const payload = "report `/tmp/archive` and $(echo hi)";
    await expect(
      resolveSpaceSendText({
        text: payload,
      })
    ).resolves.toBe(payload);
  });

  it("uses stdin source when --stdin is enabled", async () => {
    const readFromStdin = vi.fn().mockResolvedValue("stdin payload");
    await expect(
      resolveSpaceSendText({
        stdin: true,
        readFromStdin,
      })
    ).resolves.toBe("stdin payload");
    expect(readFromStdin).toHaveBeenCalledTimes(1);
  });

  it("keeps multiline stdin payload unchanged", async () => {
    const payload = "line-1\n`/tmp/archive`\nline-3";
    await expect(
      resolveSpaceSendText({
        stdin: true,
        readFromStdin: async () => payload,
      })
    ).resolves.toBe(payload);
  });

  it("uses file source when --file is provided", async () => {
    const readFromFile = vi.fn().mockResolvedValue("file payload");
    await expect(
      resolveSpaceSendText({
        file: "/tmp/message.txt",
        readFromFile,
      })
    ).resolves.toBe("file payload");
    expect(readFromFile).toHaveBeenCalledWith("/tmp/message.txt");
  });

  it("keeps multiline file payload unchanged", async () => {
    const payload = "A\nB with `code`\nC";
    await expect(
      resolveSpaceSendText({
        file: "/tmp/message.txt",
        readFromFile: async () => payload,
      })
    ).resolves.toBe(payload);
  });

  it("fails with send.input.required when no input source is provided", async () => {
    await expect(resolveSpaceSendText({})).rejects.toMatchObject({
      code: "send.input.required",
    });
  });

  it("fails with send.input.conflict when multiple sources are provided", async () => {
    await expect(
      resolveSpaceSendText({
        text: "hello",
        stdin: true,
      })
    ).rejects.toMatchObject({
      code: "send.input.conflict",
    });
    await expect(
      resolveSpaceSendText({
        text: "hello",
        file: "/tmp/message.txt",
      })
    ).rejects.toMatchObject({
      code: "send.input.conflict",
    });
    await expect(
      resolveSpaceSendText({
        stdin: true,
        file: "/tmp/message.txt",
      })
    ).rejects.toMatchObject({
      code: "send.input.conflict",
    });
  });

  it("fails with send.input.file_read_failed when file read fails", async () => {
    await expect(
      resolveSpaceSendText({
        file: "/tmp/missing.txt",
        readFromFile: () => {
          throw new Error("ENOENT");
        },
      })
    ).rejects.toMatchObject({
      code: "send.input.file_read_failed",
    });
  });

  it("fails with send.input.empty when resolved text is empty", async () => {
    await expect(
      resolveSpaceSendText({
        text: "   ",
      })
    ).rejects.toMatchObject({
      code: "send.input.empty",
    });
    await expect(
      resolveSpaceSendText({
        stdin: true,
        readFromStdin: async () => "\n\t ",
      })
    ).rejects.toMatchObject({
      code: "send.input.empty",
    });
    await expect(
      resolveSpaceSendText({
        file: "/tmp/empty.txt",
        readFromFile: async () => "",
      })
    ).rejects.toMatchObject({
      code: "send.input.empty",
    });
  });
});
