import type { OpenMeldEnvironmentTarget } from "../config/openmeld-environment-target";
import type { OpenMeldProfile } from "../config/openmeld-profiles-api";
import type { Presenter } from "../runtime/presenter";
import type { RuntimeContext } from "../runtime/types";

export type CommandCheckName =
  | "disclaimer"
  | "cliUpdate"
  | "signIn"
  | "selectedProfile"
  | "localRuntimeState"
  | "service"
  | "skills";

export type CommandCheckMode =
  | "skip"
  | "required"
  | "confirm"
  | "optional"
  | "status-only"
  | "auto-fix";

export type CommandCheckStage =
  | "before-entry"
  | "after-sign-in"
  | "after-profile"
  | "status-only";

export type CommandCheckRequirement = {
  mode: CommandCheckMode;
  stage: CommandCheckStage;
};

export type CommandCheckRequirements = Record<
  CommandCheckName,
  CommandCheckRequirement
>;

export type CommandEntryName =
  | "root"
  | "view"
  | "start"
  | "setup"
  | "feedback"
  | "repair.local-state"
  | "uninstall"
  | "reset"
  | "upgrade"
  | "auth.menu"
  | "auth.status"
  | "auth.login"
  | "auth.logout"
  | "organization.list"
  | "organization.current"
  | "organization.switch"
  | "organization.directory"
  | "organization.computers"
  | "organization.invite_link.get"
  | "organization.invite_link.create"
  | "organization.invite_link.revoke"
  | "center_agent.menu"
  | "center_agent.ask"
  | "center_agent.context"
  | "center_agent.status"
  | "center_agent.designate"
  | "center_agent.pause"
  | "center_agent.resume"
  | "center_agent.audit"
  | "member_agents.list"
  | "member_agents.show"
  | "member_agents.add"
  | "member_agents.sessions.list"
  | "member_agents.sessions.rename"
  | "member_agents.sessions.archive"
  | "member_agents.sessions.restore"
  | "member_agents.sessions.delete"
  | "routines.menu"
  | "routines.list"
  | "routines.create"
  | "routines.show"
  | "routines.update"
  | "routines.pause"
  | "routines.resume"
  | "routines.delete"
  | "routines.runs"
  | "projects.menu"
  | "projects.list"
  | "projects.create"
  | "projects.update"
  | "projects.archive"
  | "projects.bind"
  | "projects.connections.menu"
  | "projects.connections.list"
  | "projects.connections.remove"
  | "projects.connections.set-default"
  | "projects.unbind"
  | "skills.menu"
  | "files.list"
  | "files.read"
  | "files.history"
  | "files.copy"
  | "files.copy-to-space"
  | "files.upload"
  | "files.write"
  | "files.download"
  | "plugins.list"
  | "plugins.connect"
  | "plugins.connection"
  | "plugins.actions"
  | "plugins.call"
  | "skills.ensure"
  | "skills.install"
  | "skills.uninstall"
  | "skills.list"
  | "skills.add"
  | "skills.scan"
  | "skills.show"
  | "skills.load"
  | "skills.check"
  | "skills.update"
  | "agents.menu"
  | "agents.detect"
  | "agents.list"
  | "agents.manage"
  | "agents.enable"
  | "agents.repair"
  | "agents.disable"
  | "agents.show"
  | "agents.login"
  | "agents.custom.list"
  | "agents.custom.add"
  | "agents.custom.update"
  | "agents.custom.remove"
  | "agents.config"
  | "computer.list"
  | "computer.cloud"
  | "computer.current"
  | "computer.rename"
  | "computer.disconnect"
  | "service.menu"
  | "service.run"
  | "service.status"
  | "service.snapshot"
  | "service.interrupt"
  | "service.cancel"
  | "service.trace"
  | "service.install"
  | "service.autostart"
  | "service.uninstall"
  | "service.reinstall"
  | "service.stop"
  | "space.menu"
  | "space.create"
  | "space.delete"
  | "space.join"
  | "space.add-me"
  | "space.add-agents"
  | "space.add-human-profiles"
  | "space.add-members"
  | "space.remove-members"
  | "space.leave"
  | "space.files.handoff"
  | "space.files.working-copy"
  | "space.files.list"
  | "space.files.read"
  | "space.files.upload"
  | "space.files.write"
  | "space.files.download"
  | "space.files.mkdir"
  | "space.files.rename"
  | "space.files.move"
  | "space.files.trash"
  | "space.files.history"
  | "space.files.restore"
  | "space.files.restore-version"
  | "space.watch"
  | "space.send"
  | "space.history"
  | "space.thread"
  | "space.board"
  | "space.members"
  | "space.contract"
  | "space.contract.set"
  | "space.publication.set"
  | "space.access"
  | "space.status"
  | "space.updates"
  | "space.result"
  | "space.list"
  | "space.list.organization"
  | "space.join.self_serve"
  | "space.wake_progress"
  | "space.respond"
  | "space.wake_stop"
  | "space.password"
  | "space.guide"
  | "space.guide.set"
  | "space.guide.clear"
  | "doctor"
  | "whoami"
  | "profile.menu"
  | "profile.create"
  | "profile.current-session"
  | "profile.list"
  | "profile.set"
  | "profile.show"
  | "profile.update"
  | "profile.execution-mode"
  | "profile.delete"
  | "profile.requests.create"
  | "profile.requests.list"
  | "profile.requests.approve"
  | "profile.requests.decline"
  | "profile.requests.cancel"
  | "profile.requests.retry"
  | "profile.requests.preferences.get"
  | "profile.requests.preferences.set";

export type CommandEntryJsonError = {
  code: string;
  message: string;
  requestId?: string;
};

export type CommandEntryResult =
  | { status: "continue" }
  | { status: "cancelled" }
  | { status: "blocked"; exitCode: number; jsonError?: CommandEntryJsonError };

export type CommandEntryContext = {
  entryName: CommandEntryName;
  argv: string[];
  runtime: RuntimeContext;
  presenter: Presenter;
  allowPrompt: boolean;
  environmentTarget: OpenMeldEnvironmentTarget;
  gatewayUrl: string | null;
  profileArg: string | null;
  // True when the command runs under `--json`. Blocking entry checks then emit
  // a canonical CLI error envelope instead of presenter output.
  jsonOutput: boolean;
};

export type CurrentCommandCheckState = {
  signIn: {
    checkedGatewayUrl: string | null;
    status:
      | "valid"
      | "missing"
      | "invalid"
      | "expired"
      | "revoked"
      | "mismatch"
      | "unavailable"
      | "unknown";
  } | null;
  selectedProfile: {
    openMeldProfileId: string;
    profile: OpenMeldProfile;
  } | null;
};
