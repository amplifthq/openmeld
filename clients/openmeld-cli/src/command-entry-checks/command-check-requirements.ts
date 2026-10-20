import type { CommandCheckRequirements, CommandEntryName } from "./types";

const SKIP_ALL_CHECKS: CommandCheckRequirements = {
  disclaimer: { mode: "skip", stage: "before-entry" },
  cliUpdate: { mode: "skip", stage: "before-entry" },
  signIn: { mode: "skip", stage: "before-entry" },
  selectedProfile: { mode: "skip", stage: "after-sign-in" },
  localRuntimeState: { mode: "skip", stage: "before-entry" },
  service: { mode: "skip", stage: "after-sign-in" },
  skills: { mode: "skip", stage: "status-only" },
};

const OPTIONAL_CLI_UPDATE = {
  cliUpdate: { mode: "optional", stage: "before-entry" },
} as const;

const REQUIRED_DISCLAIMER = {
  disclaimer: { mode: "required", stage: "before-entry" },
} as const;

const AUTO_FIX_LOCAL_RUNTIME = {
  localRuntimeState: { mode: "auto-fix", stage: "before-entry" },
} as const;

const REQUIRED_SIGN_IN = {
  signIn: { mode: "required", stage: "before-entry" },
} as const;

const OPTIONAL_SIGN_IN = {
  signIn: { mode: "optional", stage: "before-entry" },
} as const;

const REQUIRED_SELECTED_PROFILE = {
  selectedProfile: { mode: "required", stage: "after-sign-in" },
} as const;

const CONFIRM_SELECTED_PROFILE = {
  selectedProfile: { mode: "confirm", stage: "after-sign-in" },
} as const;

const STATUS_ONLY_SERVICE = {
  service: { mode: "status-only", stage: "status-only" },
} as const;

function buildCommandChecks(
  ...parts: Partial<CommandCheckRequirements>[]
): CommandCheckRequirements {
  return Object.freeze(
    Object.assign({}, SKIP_ALL_CHECKS, ...parts)
  ) as CommandCheckRequirements;
}

export const COMMAND_CHECK_REQUIREMENTS: Readonly<
  Record<CommandEntryName, CommandCheckRequirements>
> = Object.freeze({
  root: buildCommandChecks(OPTIONAL_CLI_UPDATE),
  "plugins.list": buildCommandChecks(OPTIONAL_CLI_UPDATE, REQUIRED_SIGN_IN),
  "plugins.connect": buildCommandChecks(OPTIONAL_CLI_UPDATE, REQUIRED_SIGN_IN),
  "plugins.connection": buildCommandChecks(
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "plugins.actions": buildCommandChecks(OPTIONAL_CLI_UPDATE, REQUIRED_SIGN_IN),
  "plugins.call": buildCommandChecks(OPTIONAL_CLI_UPDATE, REQUIRED_SIGN_IN),
  view: buildCommandChecks(OPTIONAL_CLI_UPDATE),
  start: buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    AUTO_FIX_LOCAL_RUNTIME
  ),
  setup: buildCommandChecks(REQUIRED_DISCLAIMER, AUTO_FIX_LOCAL_RUNTIME),
  feedback: buildCommandChecks(OPTIONAL_CLI_UPDATE),
  "repair.local-state": buildCommandChecks(REQUIRED_DISCLAIMER),
  uninstall: buildCommandChecks(REQUIRED_DISCLAIMER),
  reset: buildCommandChecks(REQUIRED_DISCLAIMER),
  upgrade: buildCommandChecks(REQUIRED_DISCLAIMER),
  "auth.menu": buildCommandChecks(REQUIRED_DISCLAIMER),
  "auth.status": buildCommandChecks(REQUIRED_DISCLAIMER),
  "auth.login": buildCommandChecks(REQUIRED_DISCLAIMER),
  "auth.logout": buildCommandChecks(REQUIRED_DISCLAIMER),
  "organization.list": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "organization.current": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "organization.switch": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "organization.directory": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "organization.computers": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "organization.invite_link.get": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "organization.invite_link.create": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "organization.invite_link.revoke": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "center_agent.menu": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "center_agent.ask": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "center_agent.context": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "center_agent.status": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "center_agent.designate": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "center_agent.pause": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "center_agent.resume": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "center_agent.audit": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "member_agents.list": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "member_agents.show": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "member_agents.add": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "member_agents.sessions.list": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "member_agents.sessions.rename": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "member_agents.sessions.archive": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "member_agents.sessions.restore": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "member_agents.sessions.delete": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "routines.menu": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "routines.list": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "routines.create": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "routines.show": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "routines.update": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "routines.pause": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "routines.resume": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "routines.delete": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "routines.runs": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "projects.menu": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "projects.list": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "projects.create": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "projects.update": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "projects.archive": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "projects.bind": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "projects.connections.menu": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "projects.connections.list": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "projects.connections.remove": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "projects.connections.set-default": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "projects.unbind": buildCommandChecks(),
  "skills.menu": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "skills.ensure": buildCommandChecks(REQUIRED_DISCLAIMER, OPTIONAL_CLI_UPDATE),
  "skills.install": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE
  ),
  "skills.uninstall": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE
  ),
  "skills.list": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "skills.add": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "skills.scan": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "files.list": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "files.read": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "files.history": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "files.copy": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "files.copy-to-space": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "files.upload": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "files.write": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "files.download": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "skills.show": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "skills.load": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "skills.check": buildCommandChecks(REQUIRED_DISCLAIMER, OPTIONAL_CLI_UPDATE),
  "skills.update": buildCommandChecks(REQUIRED_DISCLAIMER, OPTIONAL_CLI_UPDATE),
  "agents.menu": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    AUTO_FIX_LOCAL_RUNTIME
  ),
  "agents.detect": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    AUTO_FIX_LOCAL_RUNTIME
  ),
  "agents.list": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    AUTO_FIX_LOCAL_RUNTIME
  ),
  "agents.manage": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    AUTO_FIX_LOCAL_RUNTIME
  ),
  "agents.enable": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    AUTO_FIX_LOCAL_RUNTIME
  ),
  "agents.repair": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    AUTO_FIX_LOCAL_RUNTIME
  ),
  "agents.disable": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    AUTO_FIX_LOCAL_RUNTIME
  ),
  "agents.show": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    AUTO_FIX_LOCAL_RUNTIME
  ),
  "agents.login": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    AUTO_FIX_LOCAL_RUNTIME
  ),
  "agents.custom.list": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    AUTO_FIX_LOCAL_RUNTIME
  ),
  "agents.custom.add": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    AUTO_FIX_LOCAL_RUNTIME
  ),
  "agents.custom.update": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    AUTO_FIX_LOCAL_RUNTIME
  ),
  "agents.custom.remove": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    AUTO_FIX_LOCAL_RUNTIME
  ),
  "agents.config": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    AUTO_FIX_LOCAL_RUNTIME
  ),
  "computer.cloud": buildCommandChecks(REQUIRED_SIGN_IN),
  "computer.list": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  // Disconnect validates the reviewed account itself. Entry checks must not
  // sign in, repair, update, or start anything before that admission.
  "computer.disconnect": buildCommandChecks(),
  "computer.current": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    AUTO_FIX_LOCAL_RUNTIME,
    REQUIRED_SIGN_IN
  ),
  "computer.rename": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    AUTO_FIX_LOCAL_RUNTIME,
    REQUIRED_SIGN_IN
  ),
  "service.menu": buildCommandChecks(REQUIRED_DISCLAIMER, OPTIONAL_CLI_UPDATE),
  "service.run": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    AUTO_FIX_LOCAL_RUNTIME,
    REQUIRED_SIGN_IN
  ),
  "service.status": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE
  ),
  "service.snapshot": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE
  ),
  "service.interrupt": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    AUTO_FIX_LOCAL_RUNTIME
  ),
  "service.cancel": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    AUTO_FIX_LOCAL_RUNTIME
  ),
  "service.trace": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN,
    REQUIRED_SELECTED_PROFILE
  ),
  "service.install": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE
  ),
  "service.autostart": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE
  ),
  "service.uninstall": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE
  ),
  "service.reinstall": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE
  ),
  "service.stop": buildCommandChecks(REQUIRED_DISCLAIMER, OPTIONAL_CLI_UPDATE),
  "space.menu": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    AUTO_FIX_LOCAL_RUNTIME,
    REQUIRED_SIGN_IN,
    CONFIRM_SELECTED_PROFILE
  ),
  "space.create": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN,
    CONFIRM_SELECTED_PROFILE
  ),
  "space.delete": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    AUTO_FIX_LOCAL_RUNTIME,
    REQUIRED_SIGN_IN,
    CONFIRM_SELECTED_PROFILE
  ),
  "space.join": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    AUTO_FIX_LOCAL_RUNTIME,
    REQUIRED_SIGN_IN,
    CONFIRM_SELECTED_PROFILE
  ),
  "space.add-me": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN,
    CONFIRM_SELECTED_PROFILE
  ),
  "space.add-agents": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN,
    CONFIRM_SELECTED_PROFILE
  ),
  "space.add-human-profiles": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN,
    CONFIRM_SELECTED_PROFILE
  ),
  "space.add-members": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN,
    CONFIRM_SELECTED_PROFILE
  ),
  "space.remove-members": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    AUTO_FIX_LOCAL_RUNTIME,
    REQUIRED_SIGN_IN,
    CONFIRM_SELECTED_PROFILE
  ),
  "space.leave": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    AUTO_FIX_LOCAL_RUNTIME,
    REQUIRED_SIGN_IN,
    CONFIRM_SELECTED_PROFILE
  ),
  "space.files.handoff": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN,
    CONFIRM_SELECTED_PROFILE
  ),
  "space.files.working-copy": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN,
    CONFIRM_SELECTED_PROFILE
  ),
  "space.files.list": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN,
    CONFIRM_SELECTED_PROFILE
  ),
  "space.files.read": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN,
    CONFIRM_SELECTED_PROFILE
  ),
  "space.files.upload": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN,
    CONFIRM_SELECTED_PROFILE
  ),
  "space.files.write": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN,
    CONFIRM_SELECTED_PROFILE
  ),
  "space.files.download": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN,
    CONFIRM_SELECTED_PROFILE
  ),
  "space.files.mkdir": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN,
    CONFIRM_SELECTED_PROFILE
  ),
  "space.files.rename": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN,
    CONFIRM_SELECTED_PROFILE
  ),
  "space.files.move": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN,
    CONFIRM_SELECTED_PROFILE
  ),
  "space.files.trash": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN,
    CONFIRM_SELECTED_PROFILE
  ),
  "space.files.history": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN,
    CONFIRM_SELECTED_PROFILE
  ),
  "space.files.restore": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN,
    CONFIRM_SELECTED_PROFILE
  ),
  "space.files.restore-version": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN,
    CONFIRM_SELECTED_PROFILE
  ),
  "space.watch": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    AUTO_FIX_LOCAL_RUNTIME,
    REQUIRED_SIGN_IN,
    CONFIRM_SELECTED_PROFILE
  ),
  "space.send": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    AUTO_FIX_LOCAL_RUNTIME,
    REQUIRED_SIGN_IN,
    CONFIRM_SELECTED_PROFILE
  ),
  "space.history": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    AUTO_FIX_LOCAL_RUNTIME,
    REQUIRED_SIGN_IN,
    CONFIRM_SELECTED_PROFILE
  ),
  "space.thread": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    AUTO_FIX_LOCAL_RUNTIME,
    REQUIRED_SIGN_IN,
    CONFIRM_SELECTED_PROFILE
  ),
  "space.board": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    AUTO_FIX_LOCAL_RUNTIME,
    REQUIRED_SIGN_IN,
    CONFIRM_SELECTED_PROFILE
  ),
  "space.members": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    AUTO_FIX_LOCAL_RUNTIME,
    REQUIRED_SIGN_IN,
    CONFIRM_SELECTED_PROFILE
  ),
  "space.contract": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    AUTO_FIX_LOCAL_RUNTIME,
    REQUIRED_SIGN_IN,
    CONFIRM_SELECTED_PROFILE
  ),
  "space.contract.set": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    AUTO_FIX_LOCAL_RUNTIME,
    REQUIRED_SIGN_IN,
    CONFIRM_SELECTED_PROFILE
  ),
  "space.publication.set": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    AUTO_FIX_LOCAL_RUNTIME,
    REQUIRED_SIGN_IN,
    CONFIRM_SELECTED_PROFILE
  ),
  "space.access": buildCommandChecks(OPTIONAL_CLI_UPDATE),
  "space.status": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    AUTO_FIX_LOCAL_RUNTIME,
    REQUIRED_SIGN_IN,
    CONFIRM_SELECTED_PROFILE
  ),
  "space.updates": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    AUTO_FIX_LOCAL_RUNTIME,
    REQUIRED_SIGN_IN,
    CONFIRM_SELECTED_PROFILE
  ),
  "space.result": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    AUTO_FIX_LOCAL_RUNTIME,
    REQUIRED_SIGN_IN,
    CONFIRM_SELECTED_PROFILE
  ),
  "space.list": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    AUTO_FIX_LOCAL_RUNTIME,
    REQUIRED_SIGN_IN,
    CONFIRM_SELECTED_PROFILE
  ),
  "space.list.organization": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN,
    CONFIRM_SELECTED_PROFILE
  ),
  "space.join.self_serve": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN,
    CONFIRM_SELECTED_PROFILE
  ),
  "space.respond": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN,
    CONFIRM_SELECTED_PROFILE
  ),
  "space.wake_progress": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN,
    CONFIRM_SELECTED_PROFILE
  ),
  "space.wake_stop": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN,
    CONFIRM_SELECTED_PROFILE
  ),
  "space.password": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    AUTO_FIX_LOCAL_RUNTIME,
    REQUIRED_SIGN_IN,
    CONFIRM_SELECTED_PROFILE
  ),
  "space.guide": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    AUTO_FIX_LOCAL_RUNTIME,
    REQUIRED_SIGN_IN,
    CONFIRM_SELECTED_PROFILE
  ),
  "space.guide.set": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    AUTO_FIX_LOCAL_RUNTIME,
    REQUIRED_SIGN_IN,
    CONFIRM_SELECTED_PROFILE
  ),
  "space.guide.clear": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    AUTO_FIX_LOCAL_RUNTIME,
    REQUIRED_SIGN_IN,
    CONFIRM_SELECTED_PROFILE
  ),
  doctor: buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    OPTIONAL_SIGN_IN,
    STATUS_ONLY_SERVICE
  ),
  whoami: buildCommandChecks(REQUIRED_DISCLAIMER, OPTIONAL_CLI_UPDATE),
  "profile.menu": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    AUTO_FIX_LOCAL_RUNTIME,
    REQUIRED_SIGN_IN
  ),
  "profile.create": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    AUTO_FIX_LOCAL_RUNTIME,
    REQUIRED_SIGN_IN
  ),
  "profile.current-session": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "profile.list": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "profile.set": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    AUTO_FIX_LOCAL_RUNTIME,
    REQUIRED_SIGN_IN
  ),
  "profile.show": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    AUTO_FIX_LOCAL_RUNTIME,
    REQUIRED_SIGN_IN
  ),
  "profile.execution-mode": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "profile.update": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    AUTO_FIX_LOCAL_RUNTIME,
    REQUIRED_SIGN_IN
  ),
  "profile.delete": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    AUTO_FIX_LOCAL_RUNTIME,
    REQUIRED_SIGN_IN
  ),
  "profile.requests.create": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "profile.requests.list": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "profile.requests.approve": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "profile.requests.decline": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "profile.requests.cancel": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "profile.requests.retry": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "profile.requests.preferences.get": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
  "profile.requests.preferences.set": buildCommandChecks(
    REQUIRED_DISCLAIMER,
    OPTIONAL_CLI_UPDATE,
    REQUIRED_SIGN_IN
  ),
});

export function getCommandCheckRequirements(
  entryName: CommandEntryName
): CommandCheckRequirements {
  return COMMAND_CHECK_REQUIREMENTS[entryName];
}
