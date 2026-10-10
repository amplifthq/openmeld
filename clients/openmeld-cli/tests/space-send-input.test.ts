import { describe, expect, it, vi } from "vitest";
import {
  resolveSpaceSendText,
  resolveSpaceTaskSelection,
  selectCliProjectWork,
} from "../src/space/send-input";

describe("space send input resolver", () => {
  it("selects one configured Project repository and freezes it in a new CLI task", () => {
    const project = {
      archivedAtMs: null,
      canArchive: false,
      canManage: false,
      createdAtMs: 1,
      createdByUserId: "user-1",
      id: "project-1",
      name: "Payments",
      organizationId: "org-1",
      repositoryFingerprint: null,
      slug: "payments",
      updatedAtMs: 1,
    };
    const settings = {
      projectId: project.id,
      repositories: [
        {
          isDefault: false,
          repositoryFingerprint: `sha256:${"a".repeat(64)}`,
          repositoryUrl: "https://github.com/acme/payments",
        },
        {
          isDefault: true,
          repositoryFingerprint: `sha256:${"b".repeat(64)}`,
          repositoryUrl: "https://github.com/acme/sdk",
        },
      ],
      legacyDefaultFingerprint: null,
      revision: 1,
      updatedAtMs: 1,
      updatedByUserId: "user-1",
    };
    const selected = selectCliProjectWork({ project, settings });
    expect(selected.repositoryFingerprint).toBe(`sha256:${"b".repeat(64)}`);
    const explicit = selectCliProjectWork({
      project,
      settings,
      repositoryUrl: "git@github.com:acme/payments.git",
    });
    expect(explicit.repositoryFingerprint).toBe(`sha256:${"a".repeat(64)}`);
    const selection = resolveSpaceTaskSelection({
      space: "a".repeat(64),
      wakeTargets: ["agt_11111111-1111-4111-8111-111111111111"],
      newTask: true,
      projectWork: explicit,
    });
    expect(selection).toMatchObject({
      mode: "new",
      workspace: "isolated",
      projectWork: explicit,
    });
    expect(selection?.mode !== "resume" && selection?.access).toBeUndefined();
    for (const taskAccess of ["workspace", "read_only"] as const) {
      expect(
        resolveSpaceTaskSelection({
          space: "a".repeat(64),
          wakeTargets: ["agt_11111111-1111-4111-8111-111111111111"],
          newTask: true,
          projectWork: explicit,
          taskAccess,
        })
      ).toMatchObject({ access: taskAccess, workspace: "isolated" });
    }
    expect(() =>
      resolveSpaceTaskSelection({
        space: "a".repeat(64),
        wakeTargets: ["agt_11111111-1111-4111-8111-111111111111"],
        projectWork: explicit,
      })
    ).toThrow("--new-task");
    expect(() =>
      selectCliProjectWork({
        project,
        settings: {
          ...settings,
          legacyDefaultFingerprint: `sha256:${"c".repeat(64)}`,
          repositories: settings.repositories.map((repository) => ({
            ...repository,
            isDefault: false,
          })),
        },
      })
    ).toThrow("Choose one with --repository");
  });
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
