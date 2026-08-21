import type { Command } from "commander";

export type ProjectOutputOptions = { json?: boolean };
export type ProjectCreateOptions = ProjectOutputOptions & {
  name?: string;
  slug?: string;
};
export type ProjectUpdateOptions = ProjectCreateOptions;
export type ProjectArchiveOptions = ProjectOutputOptions & { yes?: boolean };
export type ProjectBindOptions = ProjectOutputOptions & {
  allowUnverified?: boolean;
  path?: string;
};
export type ProjectUnbindOptions = ProjectOutputOptions & {
  organization?: string;
  projectId?: string;
};
export type ProjectConnectionsSetDefaultOptions = ProjectOutputOptions & {
  generation?: string;
};
export type ProjectConnectionsRemoveOptions = ProjectOutputOptions & {
  generation?: string;
  path?: string;
  replacementGeneration?: string;
};

export type ProjectCommandHandlers = {
  archive: (projectId: string, options: ProjectArchiveOptions) => Promise<void>;
  bind: (projectSlug: string, options: ProjectBindOptions) => Promise<void>;
  connectionsList: (
    projectSlug: string,
    options: ProjectOutputOptions
  ) => Promise<void>;
  connectionsRemove: (
    projectSlug: string,
    options: ProjectConnectionsRemoveOptions
  ) => Promise<void>;
  connectionsSetDefault: (
    projectSlug: string,
    options: ProjectConnectionsSetDefaultOptions
  ) => Promise<void>;
  create: (options: ProjectCreateOptions) => Promise<void>;
  list: (options: ProjectOutputOptions) => Promise<void>;
  unbind: (projectSlug: string, options: ProjectUnbindOptions) => Promise<void>;
  update: (projectId: string, options: ProjectUpdateOptions) => Promise<void>;
};

export type AgentActivityCommandHandlers = {
  context: (options: ProjectOutputOptions & { path?: string }) => Promise<void>;
  health: (options: ProjectOutputOptions) => Promise<void>;
  hook: (options: { owner?: string; provider?: string }) => Promise<void>;
  install: (options: ProjectOutputOptions) => Promise<void>;
  read: (options: {
    json?: boolean;
    member?: string;
    project?: string;
    provider?: string;
    status?: string;
    view?: string;
  }) => Promise<void>;
  sessions: (options: {
    cursor?: string;
    json?: boolean;
    limit?: string;
    member?: string;
    nativeSession?: string;
    origin?: string;
    project?: string;
    provider?: string;
    query?: string;
    status?: string;
    view?: string;
  }) => Promise<void>;
  status: (options: ProjectOutputOptions) => Promise<void>;
  sync: (options: ProjectOutputOptions) => Promise<void>;
  uninstall: (options: ProjectOutputOptions) => Promise<void>;
};

type AgentActivityReadOptions = Parameters<
  AgentActivityCommandHandlers["read"]
>[0];
type AgentActivitySessionsOptions = Parameters<
  AgentActivityCommandHandlers["sessions"]
>[0];

export function registerAgentActivityCommands(
  program: Command,
  handlers: AgentActivityCommandHandlers
): Command {
  const activity = program
    .command("activity")
    .description("Share and inspect safe coding-agent activity metadata.");
  const runRead = async (
    _options: AgentActivityReadOptions,
    command: Command
  ) => {
    await handlers.read(command.optsWithGlobals<AgentActivityReadOptions>());
  };
  const runWithActivityJson =
    <T extends ProjectOutputOptions>(handler: (options: T) => Promise<void>) =>
    async (options: T, command: Command) => {
      await handler({
        ...options,
        ...command.opts<T>(),
        json: Boolean(
          options.json ||
            command.opts<ProjectOutputOptions>().json ||
            activity.opts<ProjectOutputOptions>().json
        ),
      });
    };
  addActivityReadOptions(activity).action(runRead);
  activity
    .command("context")
    .description(
      "Read fresh cached Organization activity context for agent startup."
    )
    .option("--path <path>", "Resolve context for this bound repository path")
    .option("--json", "Print one machine-readable JSON envelope.", false)
    .action(runWithActivityJson(handlers.context));
  addActivityReadOptions(
    activity
      .command("read")
      .description(
        "Read the current Organization's safe Agent Activity snapshot."
      )
  ).action(runRead);
  addActivitySessionsOptions(
    activity
      .command("sessions")
      .description(
        "List the Organization's authorized Local Agent Session Inventory."
      )
  ).action(async (_options: AgentActivitySessionsOptions, command: Command) => {
    await handlers.sessions(
      command.optsWithGlobals<AgentActivitySessionsOptions>()
    );
  });
  activity
    .command("install")
    .description(
      "Enable managed Codex, Claude Code, Cursor, and OpenCode observers."
    )
    .option("--json", "Print one machine-readable JSON envelope.", false)
    .action(runWithActivityJson(handlers.install));
  activity
    .command("uninstall")
    .description("Remove only OpenMeld-owned activity observers.")
    .option("--json", "Print one machine-readable JSON envelope.", false)
    .action(runWithActivityJson(handlers.uninstall));
  activity
    .command("status")
    .description("Show managed observer and local outbox status.")
    .option("--json", "Print one machine-readable JSON envelope.", false)
    .action(runWithActivityJson(handlers.status));
  activity
    .command("health")
    .description(
      "Show pending, retrying, and the latest 200 permanently rejected events."
    )
    .option("--json", "Print one machine-readable JSON envelope.", false)
    .action(runWithActivityJson(handlers.health));
  activity
    .command("sync")
    .description("Reconcile local sessions and submit due events now.")
    .option("--json", "Print one machine-readable JSON envelope.", false)
    .action(runWithActivityJson(handlers.sync));
  activity
    .command("hook", { hidden: true })
    .requiredOption("--owner <owner>")
    .action(
      async (_options: { owner?: string }, command: Command) =>
        await handlers.hook(
          command.optsWithGlobals<{ owner?: string; provider?: string }>()
        )
    );
  return activity;
}

function addActivityReadOptions(command: Command) {
  return command
    .option("--project <project-slug>", "Filter by Project slug")
    .option("--member <member-user-id>", "Filter by member user id")
    .option(
      "--provider <provider>",
      "Filter by codex, claude-code, cursor, or opencode"
    )
    .option(
      "--status <status>",
      "Filter by active, idle, ended, error, or unknown"
    )
    .option("--view <mode>", "Output view: human or agent", "human")
    .option("--json", "Print one machine-readable JSON envelope.", false);
}

function addActivitySessionsOptions(command: Command) {
  return command
    .option("--project <project-slug>", "Filter by Project slug")
    .option("--member <member-user-id>", "Filter by member user id")
    .option(
      "--provider <provider>",
      "Filter by codex, claude-code, cursor, opencode, or grok-build"
    )
    .option(
      "--status <status>",
      "Filter by working, idle, ended, error, or unknown"
    )
    .option("--origin <origin>", "Filter by openmeld, local, or unknown")
    .option("--native-session <id>", "Locate one Native Session ID")
    .option("--query <text>", "Search Native Session title or ID")
    .option("--limit <count>", "Page size, from 1 through 100", "50")
    .option("--cursor <cursor>", "Continue from a prior page cursor")
    .option("--view <mode>", "Output view: human or agent", "human")
    .option("--json", "Print one machine-readable JSON envelope.", false);
}

export function registerProjectCommands(
  program: Command,
  handlers: ProjectCommandHandlers
): Command {
  const projects = program
    .command("projects")
    .description("Manage Agent Activity Projects and local opt-in bindings.");

  projects
    .command("list")
    .description("List Projects and this device's local bindings.")
    .option("--json", "Print one machine-readable JSON envelope.", false)
    .action(handlers.list);

  projects
    .command("create")
    .description("Create an Agent Activity Project.")
    .requiredOption("--name <name>", "Human-readable Project name")
    .requiredOption("--slug <slug>", "Stable Project slug")
    .option("--json", "Print one machine-readable JSON envelope.", false)
    .action(handlers.create);

  projects
    .command("update")
    .description("Update explicitly selected Project fields.")
    .argument("<project-id>", "Project ID")
    .option("--name <name>", "New Project name")
    .option("--slug <slug>", "New Project slug")
    .option("--json", "Print one machine-readable JSON envelope.", false)
    .action(handlers.update);

  projects
    .command("archive")
    .description("Archive a Project and stop new local activity.")
    .argument("<project-id>", "Project ID")
    .option("--yes", "Confirm the archive operation", false)
    .option("--json", "Print one machine-readable JSON envelope.", false)
    .action(handlers.archive);

  projects
    .command("bind")
    .description("Opt this local repository into one Project.")
    .argument("<project-slug>", "Project slug")
    .option("--path <path>", "Local repository path (defaults to cwd)")
    .option(
      "--allow-unverified",
      "Confirm connecting a non-Git folder without automatic matching",
      false
    )
    .option("--json", "Print one machine-readable JSON envelope.", false)
    .action(handlers.bind);

  const connections = projects
    .command("connections")
    .description("Manage this device's local connections for one Project.");

  connections
    .command("list")
    .description("List local paths, availability, and the default connection.")
    .argument("<project-slug>", "Project slug")
    .option("--json", "Print one machine-readable JSON envelope.", false)
    .action(handlers.connectionsList);

  connections
    .command("set-default")
    .description("Choose the connection used for future local sessions.")
    .argument("<project-slug>", "Project slug")
    .requiredOption(
      "--generation <binding-generation>",
      "Connection binding generation"
    )
    .option("--json", "Print one machine-readable JSON envelope.", false)
    .action(handlers.connectionsSetDefault);

  connections
    .command("remove")
    .description("Remove exactly one local Project connection.")
    .argument("<project-slug>", "Project slug")
    .option("--generation <binding-generation>", "Connection generation")
    .option("--path <path>", "Connected local path")
    .option(
      "--replacement-generation <binding-generation>",
      "Replacement when removing the default connection"
    )
    .option("--json", "Print one machine-readable JSON envelope.", false)
    .action(handlers.connectionsRemove);

  projects
    .command("unbind")
    .description("Stop collecting new activity for one local Project.")
    .argument("<project-slug>", "Project slug")
    .option(
      "--organization <organization-id>",
      "Organization id when the same slug has multiple local bindings"
    )
    .option(
      "--project-id <project-id>",
      "Project id when a reused slug matches multiple local Projects"
    )
    .option("--json", "Print one machine-readable JSON envelope.", false)
    .action(handlers.unbind);

  return projects;
}
