import type { WorkspaceClient } from "@cloudflare/computer";
import { describe, expect, it, vi } from "vitest";
import { getComputerVideoInspectionTool } from "../flue-adapter/computer-video-inspection";

const VIDEO_OUTPUT_DIRECTORY = /'([^']+\/video-inspection\/[^/']+)\//u;

describe("Computer video inspection", () => {
  it("samples a bounded interval, transcribes its audio, and removes derivatives", async () => {
    const files = new Map<string, Uint8Array>([
      ["/computer/work/clip.mp4", new Uint8Array([1, 2, 3])],
    ]);
    const removed: string[] = [];
    const workspace = {
      fs: {
        lstat: vi.fn(async (path: string) => ({
          isFile: files.has(path),
          isSymbolicLink: false,
          size: files.get(path)?.byteLength ?? 0,
        })),
        mkdir: vi.fn(async () => undefined),
        readdir: vi.fn(async (directory: string) =>
          Array.from(files.keys())
            .filter((path) => path.startsWith(`${directory}/frame-`))
            .map((path) => ({ name: path.slice(directory.length + 1) }))
        ),
        readFile: vi.fn((path: string) => {
          const bytes = files.get(path);
          if (!bytes) {
            throw new Error("Missing file");
          }
          return Promise.resolve(new Blob([Uint8Array.from(bytes)]).stream());
        }),
        rm: vi.fn((path: string) => {
          removed.push(path);
          for (const file of files.keys()) {
            if (file.startsWith(`${path}/`)) {
              files.delete(file);
            }
          }
          return Promise.resolve();
        }),
      },
    } as unknown as WorkspaceClient;
    const commands: string[] = [];
    const reserved = new Set<string>();
    const understandFrames = vi.fn(
      async (
        frames: readonly import("../agent-core/submission").RemoteAgentAdmissionImage[]
      ) => {
        expect(frames).toHaveLength(2);
        expect(frames[0]?.filename).toContain("60.0s");
        const first = frames[0];
        if (!(first && "openStream" in first)) {
          throw new Error("Missing sampled frame");
        }
        expect(
          new Uint8Array(
            await new Response(await first.openStream()).arrayBuffer()
          )
        ).toEqual(new Uint8Array([9, 8]));
        return "A person waves at the camera.";
      }
    );
    const transcribeAudio = vi.fn((bytes: Uint8Array) => {
      expect(bytes).toEqual(new Uint8Array([4, 5]));
      return Promise.resolve("Hello there.");
    });
    const tool = getComputerVideoInspectionTool({
      computerExec: vi.fn((command: string, options) => {
        expect(options?.backend).toBe("container");
        commands.push(command);
        if (
          command.startsWith("ffprobe") &&
          command.includes("format=duration")
        ) {
          return Promise.resolve({ exitCode: 0, stdout: "180\n", stderr: "" });
        }
        if (command.startsWith("ffprobe")) {
          return Promise.resolve({ exitCode: 0, stdout: "1\n", stderr: "" });
        }
        const directory = command.match(VIDEO_OUTPUT_DIRECTORY)?.[1];
        if (!directory) {
          throw new Error(`Missing output directory: ${command}`);
        }
        if (command.includes("frame-%03d.jpg")) {
          files.set(`${directory}/frame-001.jpg`, new Uint8Array([9, 8]));
          files.set(`${directory}/frame-002.jpg`, new Uint8Array([7, 6]));
        } else {
          files.set(`${directory}/audio.mp3`, new Uint8Array([4, 5]));
        }
        return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
      }),
      understandFrames,
      transcribeAudio,
      storage: {
        putIfAbsentExpiring: (key) => {
          if (reserved.has(key)) {
            return Promise.resolve(false);
          }
          reserved.add(key);
          return Promise.resolve(true);
        },
      },
      submissionId: "video-test",
      workspaceAccess: {
        withWorkspace: async (operation) => await operation(workspace),
      },
      workingDirectory: "/computer/work",
    });
    const result = await tool.execute({
      path: "clip.mp4",
      startSeconds: 60,
      durationSeconds: 30,
    });
    expect(result).toMatchObject({
      totalDurationSeconds: 180,
      inspectedFromSeconds: 60,
      inspectedToSeconds: 90,
      sampledFrames: 2,
      visualSummary: "A person waves at the camera.",
      audioTranscript: "Hello there.",
    });
    expect(
      commands.filter((command) => command.startsWith("ffmpeg"))
    ).toHaveLength(2);
    expect(removed).toHaveLength(1);
    expect(Array.from(files.keys())).toEqual(["/computer/work/clip.mp4"]);
    await expect(
      tool.execute({ path: "clip.mp4", durationSeconds: 31 })
    ).rejects.toThrow();
    expect(commands).toHaveLength(4);
    for (let index = 1; index < 10; index += 1) {
      await tool.execute({ path: "clip.mp4", startSeconds: 60 });
    }
    await expect(
      tool.execute({ path: "clip.mp4", startSeconds: 60 })
    ).rejects.toThrow("ten video intervals");
    expect(commands).toHaveLength(40);
  });
});
