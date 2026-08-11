import { describe, expect, it } from "vitest";
import {
  agentStreamToolPartSchema,
  isAgentWorkActivityPresentable,
  resolveCommandAgentWorkActivity,
} from "../../src/index";

describe("Agent work command semantics", () => {
  it("classifies common command work from the executable instead of matching incidental text", () => {
    expect(resolveCommandAgentWorkActivity("rg -n TODO src")).toEqual({
      v: 1,
      key: "source.search",
    });
    expect(
      resolveCommandAgentWorkActivity("sed -n '1,80p' src/index.ts")
    ).toEqual({
      v: 1,
      key: "source.read",
    });
    expect(resolveCommandAgentWorkActivity("git log -5 --oneline")).toEqual({
      v: 1,
      key: "repository.inspect",
    });
    expect(resolveCommandAgentWorkActivity("command -v vitest")).toEqual({
      v: 1,
      key: "environment.check",
    });
    expect(resolveCommandAgentWorkActivity("echo git status")).toBeNull();
  });

  it("recognizes work after an explicit shell sequence without exposing arguments", () => {
    expect(
      resolveCommandAgentWorkActivity("cd /private/worktree && pnpm test")
    ).toEqual({
      v: 1,
      key: "tests.run",
    });
    expect(
      resolveCommandAgentWorkActivity("node ./scripts/verify-release.mjs")
    ).toBeNull();
    expect(
      resolveCommandAgentWorkActivity("pnpm run private-release-step")
    ).toBeNull();
    expect(resolveCommandAgentWorkActivity("pnpm private-command")).toBeNull();
    expect(resolveCommandAgentWorkActivity("print-secret")).toBeNull();
  });

  it("keeps only a safe repository label for clone work", () => {
    expect(
      resolveCommandAgentWorkActivity(
        "git clone git@github.com:amplifthq/reply.git /Users/private/reply"
      )
    ).toEqual({
      v: 1,
      key: "repository.clone",
      subject: {
        kind: "repository",
        label: "amplifthq/reply",
      },
    });
  });

  it("does not describe mutating or unrelated command variants as read work", () => {
    expect(
      resolveCommandAgentWorkActivity("sed -i '' 's/a/b/' file.ts")
    ).toEqual({
      v: 1,
      key: "source.update",
    });
    expect(resolveCommandAgentWorkActivity("find . -delete")).toEqual({
      v: 1,
      key: "source.update",
    });
    expect(
      resolveCommandAgentWorkActivity("find . -exec arbitrary-tool {} \\;")
    ).toBeNull();
    expect(resolveCommandAgentWorkActivity("fd . -x rm")).toBeNull();
    expect(
      resolveCommandAgentWorkActivity("fd . --exec-batch arbitrary-tool")
    ).toBeNull();
    expect(
      resolveCommandAgentWorkActivity("cat src/a.ts > src/b.ts")
    ).toBeNull();
    expect(resolveCommandAgentWorkActivity("git branch -D old")).toBeNull();
    expect(resolveCommandAgentWorkActivity("git branch -Dold")).toBeNull();
    expect(
      resolveCommandAgentWorkActivity("git branch --move old new")
    ).toBeNull();
    expect(
      resolveCommandAgentWorkActivity("git branch new-feature")
    ).toBeNull();
    expect(resolveCommandAgentWorkActivity("git branch --all")).toEqual({
      v: 1,
      key: "repository.check",
    });
    expect(resolveCommandAgentWorkActivity("pipx list")).toBeNull();
  });

  it("hides commands whose shell structure could conceal different work", () => {
    expect(
      resolveCommandAgentWorkActivity("echo ok # ignored; pnpm test")
    ).toBeNull();
    expect(
      resolveCommandAgentWorkActivity("python <<EOF\npnpm test\nEOF")
    ).toBeNull();
    expect(
      resolveCommandAgentWorkActivity('rg "$(rm -f file)" src')
    ).toBeNull();
    expect(resolveCommandAgentWorkActivity("rg `rm -f file` src")).toBeNull();
    expect(
      resolveCommandAgentWorkActivity("rg TODO src; rm -f private.txt")
    ).toBeNull();
    expect(
      resolveCommandAgentWorkActivity("rm -f private.txt; pnpm test")
    ).toBeNull();
    expect(
      resolveCommandAgentWorkActivity("pnpm check && pnpm test")
    ).toBeNull();
    expect(resolveCommandAgentWorkActivity("true || pnpm test")).toBeNull();
    expect(
      resolveCommandAgentWorkActivity("printf x > file && pnpm test")
    ).toBeNull();
    expect(
      resolveCommandAgentWorkActivity("cd /private/worktree && pnpm test")
    ).toEqual({
      v: 1,
      key: "tests.run",
    });
  });

  it("rejects subject kinds that are not explicitly allowed for the work key", () => {
    expect(
      agentStreamToolPartSchema.safeParse({
        type: "tool",
        toolCallId: "tool-call-1",
        toolName: "Bash",
        state: "output-available",
        work: {
          v: 1,
          key: "tests.run",
          subject: {
            kind: "document",
            label: "/private/path",
          },
        },
      }).success
    ).toBe(false);
    expect(
      agentStreamToolPartSchema.safeParse({
        type: "tool",
        toolCallId: "tool-call-2",
        toolName: "web_fetch",
        state: "output-available",
        work: {
          v: 1,
          key: "webpage.read",
          subject: {
            kind: "website",
            label: "docs.example.com",
          },
        },
      }).success
    ).toBe(true);
    const compatibilityWork = {
      v: 1 as const,
      key: "connected_app.action.execute" as const,
    };
    expect(
      agentStreamToolPartSchema.safeParse({
        type: "tool",
        toolCallId: "tool-call-3",
        toolName: "openmeld_execute_app_action",
        state: "output-available",
        work: compatibilityWork,
      }).success
    ).toBe(true);
    expect(isAgentWorkActivityPresentable(compatibilityWork)).toBe(false);
    expect(
      isAgentWorkActivityPresentable({
        ...compatibilityWork,
        subject: {
          kind: "connected_app",
          label: "PostHog: list projects",
        },
      })
    ).toBe(true);
    expect(
      agentStreamToolPartSchema.safeParse({
        type: "tool",
        toolCallId: "tool-call-private-repository",
        toolName: "git_clone",
        state: "output-available",
        work: {
          v: 1,
          key: "repository.clone",
          subject: {
            kind: "repository",
            label: "/Users/felix/private-client",
          },
        },
      }).success
    ).toBe(false);
    expect(
      agentStreamToolPartSchema.safeParse({
        type: "tool",
        toolCallId: "tool-call-private-website",
        toolName: "web_fetch",
        state: "output-available",
        work: {
          v: 1,
          key: "webpage.read",
          subject: {
            kind: "website",
            label: "example.com/path?token=secret",
          },
        },
      }).success
    ).toBe(false);
    expect(
      agentStreamToolPartSchema.safeParse({
        type: "tool",
        toolCallId: "tool-call-multiline-label",
        toolName: "openmeld_create_project",
        state: "output-available",
        work: {
          v: 1,
          key: "project.create",
          subject: {
            kind: "project",
            label: "Launch\nprivate details",
          },
        },
      }).success
    ).toBe(false);
  });

  it("admits canonical Center Agent Task creation as distinct user-visible work", () => {
    expect(
      agentStreamToolPartSchema.safeParse({
        type: "tool",
        toolCallId: "tool-call-center-agent-task",
        toolName: "openmeld_create_task",
        state: "output-available",
        work: {
          v: 1,
          key: "center_agent.task.create",
        },
      }).success
    ).toBe(true);
  });
});
