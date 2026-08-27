import { describe, expect, it } from "vitest";
import {
  REMOTE_AGENT_EVENT_AUTHORIZED_TOOL_NAMES,
  REMOTE_AGENT_OPENMELD_TOOL_NAMES,
} from "../agent-core/tools";
import { REMOTE_AGENT_CODE_MODE_TOOL_NAME } from "../flue-adapter/code-mode";
import { REMOTE_AGENT_SANDBOX_TOOL_NAMES } from "../flue-adapter/sandbox-tools";
import { resolveRemoteAgentToolWorkActivity } from "../flue-adapter/tool-work-activity";

describe("Remote Agent user-visible work semantics", () => {
  it("covers every direct OpenMeld, connected app, web, and GitHub tool", () => {
    for (const toolName of [
      ...REMOTE_AGENT_OPENMELD_TOOL_NAMES,
      ...REMOTE_AGENT_EVENT_AUTHORIZED_TOOL_NAMES,
    ]) {
      expect(
        resolveRemoteAgentToolWorkActivity(toolName, inputForTool(toolName)),
        toolName
      ).not.toBeNull();
    }
  });

  it("covers concrete Sandbox work and hides commands it cannot describe", () => {
    for (const toolName of REMOTE_AGENT_SANDBOX_TOOL_NAMES) {
      if (toolName === "bash") {
        continue;
      }
      expect(
        resolveRemoteAgentToolWorkActivity(toolName, {}),
        toolName
      ).not.toBeNull();
    }
    expect(
      resolveRemoteAgentToolWorkActivity("bash", {
        command: "pnpm test",
      })
    ).toEqual({
      v: 1,
      key: "tests.run",
    });
    expect(
      resolveRemoteAgentToolWorkActivity("bash", {
        command: "print-secret",
      })
    ).toBeNull();
  });

  it("keeps the Code Mode wrapper and unknown internal tools hidden", () => {
    expect(
      resolveRemoteAgentToolWorkActivity(REMOTE_AGENT_CODE_MODE_TOOL_NAME, {})
    ).toBeNull();
    expect(
      resolveRemoteAgentToolWorkActivity("private_internal_tool", {})
    ).toBeNull();
  });

  it("describes a member Service-status read precisely", () => {
    expect(
      resolveRemoteAgentToolWorkActivity(
        "openmeld_read_member_openmeld_service_status",
        { memberUserId: "user_1" }
      )
    ).toEqual({
      v: 1,
      key: "organization.member_service_status.read",
    });
  });

  it("describes a member Computer read precisely", () => {
    expect(
      resolveRemoteAgentToolWorkActivity("openmeld_read_member_computers", {
        memberUserId: "user_1",
      })
    ).toEqual({
      v: 1,
      key: "organization.member_computers.read",
    });
  });

  it("describes owner Computer maintenance controls precisely", () => {
    expect(
      resolveRemoteAgentToolWorkActivity("openmeld_update_openmeld_tools", {})
    ).toEqual({ key: "computer.openmeld_tools.update", v: 1 });
    expect(
      resolveRemoteAgentToolWorkActivity(
        "openmeld_set_openmeld_tools_updates",
        { enabled: true }
      )
    ).toEqual({ key: "computer.openmeld_tools.settings.update", v: 1 });
    expect(
      resolveRemoteAgentToolWorkActivity(
        "openmeld_list_local_agent_installations",
        { agentId: "codex" }
      )
    ).toEqual({ key: "computer.local_agent.installations.read", v: 1 });
    expect(
      resolveRemoteAgentToolWorkActivity(
        "openmeld_select_local_agent_installation",
        { agentId: "codex", installationId: "install-nvm" }
      )
    ).toEqual({ key: "computer.local_agent.installation.select", v: 1 });
  });

  it("describes Space file reads and writes as distinct user-visible work", () => {
    expect(
      resolveRemoteAgentToolWorkActivity("openmeld_list_space_files", {
        spaceId: "space_1",
      })
    ).toEqual({
      v: 1,
      key: "space.files.read",
    });
    expect(
      resolveRemoteAgentToolWorkActivity("openmeld_save_space_file", {
        action: "update",
        spaceId: "space_1",
      })
    ).toEqual({
      v: 1,
      key: "space.files.update",
    });
  });

  it("reuses bounded documentation-read work for the Changelog", () => {
    expect(
      resolveRemoteAgentToolWorkActivity("openmeld_read_changelog", {})
    ).toEqual({
      v: 1,
      key: "documentation.read",
    });
  });

  it("describes Opportunity reads and decisions without inventing a new work taxonomy", () => {
    expect(
      resolveRemoteAgentToolWorkActivity("openmeld_list_opportunities", {})
    ).toEqual({
      v: 1,
      key: "center_agent.activity.read",
    });
    expect(
      resolveRemoteAgentToolWorkActivity("openmeld_recommend_opportunity", {})
    ).toEqual({
      v: 1,
      key: "center_agent.attention.request",
    });
    expect(
      resolveRemoteAgentToolWorkActivity("openmeld_respond_to_opportunity", {})
    ).toEqual({
      v: 1,
      key: "center_agent.attention.request",
    });
  });

  it("describes starting the current member's learning run precisely", () => {
    expect(
      resolveRemoteAgentToolWorkActivity("openmeld_learn_about_me", {})
    ).toEqual({
      v: 1,
      key: "organization.member_research.start",
    });
  });

  it("describes private Slack teammate invitations as Organization invitation work", () => {
    expect(
      resolveRemoteAgentToolWorkActivity("openmeld_invite_slack_teammates", {
        slackUserIds: ["U_TEAMMATE"],
      })
    ).toEqual({
      key: "organization.invite.create",
      v: 1,
    });
  });

  it("describes Slack file reads and sends precisely", () => {
    expect(
      resolveRemoteAgentToolWorkActivity("openmeld_read_slack_file", {
        fileId: "F_FILE",
      })
    ).toEqual({
      key: "slack.file.read",
      v: 1,
    });
    expect(
      resolveRemoteAgentToolWorkActivity("openmeld_send_slack_file", {
        filePath: "report.pdf",
      })
    ).toEqual({
      key: "slack.file.send",
      v: 1,
    });
  });

  it("describes canonical Center Agent Task creation without using execution-handle semantics", () => {
    expect(
      resolveRemoteAgentToolWorkActivity("openmeld_create_task", {
        title: "Research onboarding",
      })
    ).toEqual({
      key: "center_agent.task.create",
      v: 1,
    });
  });

  it("describes Organization Skill work precisely", () => {
    expect(
      resolveRemoteAgentToolWorkActivity("openmeld_read_organization_skills", {
        action: "list",
      })
    ).toEqual({
      v: 1,
      key: "organization.skills.read",
    });
    expect(
      resolveRemoteAgentToolWorkActivity(
        "openmeld_install_organization_skill",
        { mode: "github" }
      )
    ).toEqual({
      v: 1,
      key: "organization.skills.install",
    });
  });

  it("adds only allowlisted, human-readable subjects", () => {
    expect(
      resolveRemoteAgentToolWorkActivity("github_get_repository", {
        owner: "amplifthq",
        repo: "openmeld",
      })
    ).toEqual({
      v: 1,
      key: "github.repository.read",
      subject: {
        kind: "repository",
        label: "amplifthq/openmeld",
      },
    });
    expect(
      resolveRemoteAgentToolWorkActivity("web_fetch", {
        url: "https://docs.example.com/private/path?token=secret",
      })
    ).toEqual({
      v: 1,
      key: "webpage.read",
      subject: {
        kind: "website",
        label: "docs.example.com",
      },
    });
    expect(
      resolveRemoteAgentToolWorkActivity("web_fetch", {
        url: `https://reference.example.com/${"private/".repeat(40)}?token=secret`,
      })
    ).toEqual({
      v: 1,
      key: "webpage.read",
      subject: {
        kind: "website",
        label: "reference.example.com",
      },
    });
    expect(
      resolveRemoteAgentToolWorkActivity("openmeld_create_project", {
        name: "Launch readiness",
      })
    ).toEqual({
      v: 1,
      key: "project.create",
      subject: {
        kind: "project",
        label: "Launch readiness",
      },
    });
    expect(
      resolveRemoteAgentToolWorkActivity("openmeld_create_agent_profile", {
        profileName: "Release Agent",
      })
    ).toEqual({
      v: 1,
      key: "agent_profile.create",
      subject: {
        kind: "agent_profile",
        label: "Release Agent",
      },
    });
    expect(
      resolveRemoteAgentToolWorkActivity(
        "openmeld_create_agent_profile_request",
        {
          profileName: "Teammate Reviewer",
        }
      )
    ).toEqual({
      v: 1,
      key: "agent_profile.create",
      subject: {
        kind: "agent_profile",
        label: "Teammate Reviewer",
      },
    });
    expect(
      resolveRemoteAgentToolWorkActivity(
        "openmeld_create_configured_agent_profile" as never,
        {
          profileName: "Configured Agent",
        }
      )
    ).toBeNull();
    expect(
      resolveRemoteAgentToolWorkActivity("openmeld_update_space_settings", {
        spaceId: "space-private-id",
      })
    ).toEqual({
      v: 1,
      key: "space.settings.update",
    });
    expect(
      resolveRemoteAgentToolWorkActivity("openmeld_list_app_actions", {
        service: "posthog",
      })
    ).toEqual({
      v: 1,
      key: "connected_app.actions.read",
      subject: {
        kind: "connected_app",
        label: "PostHog",
      },
    });
    expect(
      resolveRemoteAgentToolWorkActivity("openmeld_execute_app_action", {
        actionId: "posthog.list_projects",
        service: "posthog",
      })
    ).toEqual({
      v: 1,
      key: "connected_app.action.execute",
      subject: {
        kind: "connected_app",
        label: "PostHog: list projects",
      },
    });
    expect(
      resolveRemoteAgentToolWorkActivity("openmeld_execute_app_action", {
        actionId: "private value",
        service: "posthog",
      })
    ).toBeNull();
    expect(
      resolveRemoteAgentToolWorkActivity("openmeld_execute_app_action", {
        actionId: "github.delete_repository",
        service: "posthog",
      })
    ).toBeNull();
  });

  it("uses the shared executable-aware command semantics", () => {
    expect(
      resolveRemoteAgentToolWorkActivity("bash", {
        command: "git show HEAD --stat",
      })
    ).toEqual({
      v: 1,
      key: "repository.inspect",
    });
    expect(
      resolveRemoteAgentToolWorkActivity("bash", {
        command: "echo pnpm test",
      })
    ).toBeNull();
  });
});

function inputForTool(toolName: string): Record<string, unknown> {
  if (toolName === "openmeld_list_app_actions") {
    return { service: "posthog" };
  }
  if (toolName === "openmeld_execute_app_action") {
    return {
      actionId: "posthog.list_projects",
      service: "posthog",
    };
  }
  return {};
}
