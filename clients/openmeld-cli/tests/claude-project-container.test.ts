import { describe, expect, it } from "vitest";
import { buildClaudeProjectContainerArgs } from "../src/local-service/file-access/claude-project-container";

describe("Claude project container argv", () => {
  it("mounts only the task workspace and removes host network and privileges", () => {
    const boundaryRoot =
      process.platform === "win32" ? "C:\\OpenMeld\\task" : "/task";
    const args = buildClaudeProjectContainerArgs({
      command: "git status --short",
      name: "openmeld-claude-project-context-1234",
      boundaryRoot,
      relativeWorkspace: "worktree",
    });
    expect(args).toContain("--rm");
    expect(args).toContain("--read-only");
    expect(args).toContain("no-new-privileges");
    expect(args).toContain("none");
    expect(args).toContain("ALL");
    expect(args).toContain(`type=bind,src=${boundaryRoot},dst=/workspace`);
    expect(args.filter((arg) => arg.startsWith("type=bind,"))).toHaveLength(1);
    expect(args[args.indexOf("--user") + 1]).toBe(
      typeof process.getuid === "function" &&
        typeof process.getgid === "function"
        ? `${process.getuid()}:${process.getgid()}`
        : "1000:1000"
    );
    expect(args).not.toContain("/var/run/docker.sock");
    expect(args.at(-1)).toBe("git status --short");
  });
});
