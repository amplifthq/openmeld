import type { Command } from "commander";
import { parseNonNegativeIntegerOption } from "../lib/number-options";
import { withSpaceProfileOption } from "../openmeld-cli-command-options";
import { runCommandWithEntryChecks } from "../openmeld-cli-entry-checks";
import { getGlobalViewOption } from "../openmeld-cli-view";
import { resolveSpaceCommandCliOptions } from "./command-cli-options";
import {
  runSpaceFilesDownload,
  runSpaceFilesHistory,
  runSpaceFilesList,
  runSpaceFilesMkdir,
  runSpaceFilesMove,
  runSpaceFilesRead,
  runSpaceFilesRename,
  runSpaceFilesRestore,
  runSpaceFilesRestoreVersion,
  runSpaceFilesTrash,
  runSpaceFilesUpload,
  runSpaceFilesWrite,
} from "./files-command";

export function registerSpaceFilesCommands(spaceCommand: Command): void {
  const filesCommand = spaceCommand
    .command("files")
    .description("Share and collaborate on files in a Space.");

  withSpaceProfileOption(
    withCommonOptions(
      filesCommand
        .command("list")
        .description("List files and folders in a Space.")
        .argument("<space>", "Space ID (64-character hex)")
        .option("--folder <folder-id>", "Folder ID, or root", "root")
        .option("--trash", "List items in Trash", false)
    )
  ).action(async (space, opts, command: Command) => {
    await runFilesCommand(command, opts, "list", async (common) => {
      await runSpaceFilesList({
        ...common,
        space: String(space).trim(),
        folder: opts.folder,
        trash: opts.trash === true,
      });
    });
  });

  withSpaceProfileOption(
    withCommonOptions(
      filesCommand
        .command("read")
        .description("Print a text Space file.")
        .argument("<space>", "Space ID (64-character hex)")
        .argument("<file-id>", "File ID")
        .option("--revision <number>", "Read a specific revision")
    )
  ).action(async (space, fileId, opts, command: Command) => {
    await runFilesCommand(command, opts, "read", async (common) => {
      await runSpaceFilesRead({
        ...common,
        space: String(space).trim(),
        fileId: String(fileId).trim(),
        revision: parseRevision(opts.revision, "--revision"),
      });
    });
  });

  withSpaceProfileOption(
    withCommonOptions(
      filesCommand
        .command("history")
        .description("List the saved versions of a Space file.")
        .argument("<space>", "Space ID (64-character hex)")
        .argument("<file-id>", "File ID")
    )
  ).action(async (space, fileId, opts, command: Command) => {
    await runFilesCommand(command, opts, "history", async (common) => {
      await runSpaceFilesHistory({
        ...common,
        space: String(space).trim(),
        fileId: String(fileId).trim(),
      });
    });
  });

  withSpaceProfileOption(
    withCommonOptions(
      filesCommand
        .command("upload")
        .description("Upload a local file into a Space.")
        .argument("<space>", "Space ID (64-character hex)")
        .argument("<file>", "Local file path")
        .option("--name <name>", "File name shown in the Space")
        .option(
          "--folder <folder-id>",
          "Destination folder ID, or root",
          "root"
        )
        .option("--type <mime-type>", "File media type")
    )
  ).action(async (space, file, opts, command: Command) => {
    await runFilesCommand(command, opts, "upload", async (common) => {
      await runSpaceFilesUpload({
        ...common,
        space: String(space).trim(),
        file: String(file),
        name: opts.name,
        folder: opts.folder,
        mimeType: opts.type,
      });
    });
  });

  withSpaceProfileOption(
    withCommonOptions(
      filesCommand
        .command("write")
        .description("Save a new revision of an existing Space file.")
        .argument("<space>", "Space ID (64-character hex)")
        .argument("<file-id>", "File ID")
        .requiredOption(
          "--base-revision <number>",
          "Revision you read before making this change"
        )
        .option("--file <path>", "Read replacement content from a local file")
        .option(
          "--stdin",
          "Read replacement content from stdin (EOF to finish)",
          false
        )
        .option("--type <mime-type>", "File media type")
    )
  ).action(async (space, fileId, opts, command: Command) => {
    await runFilesCommand(command, opts, "write", async (common) => {
      await runSpaceFilesWrite({
        ...common,
        space: String(space).trim(),
        fileId: String(fileId).trim(),
        baseRevision: parseRequiredRevision(
          opts.baseRevision,
          "--base-revision"
        ),
        file: opts.file,
        stdin: opts.stdin === true,
        mimeType: opts.type ?? (opts.stdin === true ? "text/plain" : undefined),
      });
    });
  });

  withSpaceProfileOption(
    withCommonOptions(
      filesCommand
        .command("download")
        .description("Download a Space file to this computer.")
        .argument("<space>", "Space ID (64-character hex)")
        .argument("<file-id>", "File ID")
        .requiredOption("--output <path>", "Destination path")
        .option("--revision <number>", "Download a specific revision")
        .option("--force", "Replace an existing destination file", false)
    )
  ).action(async (space, fileId, opts, command: Command) => {
    await runFilesCommand(command, opts, "download", async (common) => {
      await runSpaceFilesDownload({
        ...common,
        space: String(space).trim(),
        fileId: String(fileId).trim(),
        output: String(opts.output),
        revision: parseRevision(opts.revision, "--revision"),
        force: opts.force === true,
      });
    });
  });

  withSpaceProfileOption(
    withCommonOptions(
      filesCommand
        .command("mkdir")
        .description("Create a folder in a Space.")
        .argument("<space>", "Space ID (64-character hex)")
        .argument("<name>", "Folder name")
        .option("--folder <folder-id>", "Parent folder ID, or root", "root")
    )
  ).action(async (space, name, opts, command: Command) => {
    await runFilesCommand(command, opts, "mkdir", async (common) => {
      await runSpaceFilesMkdir({
        ...common,
        space: String(space).trim(),
        name: String(name),
        folder: opts.folder,
      });
    });
  });

  withSpaceProfileOption(
    withCommonOptions(
      filesCommand
        .command("rename")
        .description("Rename a Space file or folder.")
        .argument("<space>", "Space ID (64-character hex)")
        .argument("<entry-id>", "File or folder ID")
        .argument("<name>", "New name")
    )
  ).action(async (space, entryId, name, opts, command: Command) => {
    await runFilesCommand(command, opts, "rename", async (common) => {
      await runSpaceFilesRename({
        ...common,
        space: String(space).trim(),
        entryId: String(entryId).trim(),
        name: String(name),
      });
    });
  });

  withSpaceProfileOption(
    withCommonOptions(
      filesCommand
        .command("move")
        .description("Move a Space file or folder.")
        .argument("<space>", "Space ID (64-character hex)")
        .argument("<entry-id>", "File or folder ID")
        .option(
          "--folder <folder-id>",
          "Destination folder ID, or root",
          "root"
        )
    )
  ).action(async (space, entryId, opts, command: Command) => {
    await runFilesCommand(command, opts, "move", async (common) => {
      await runSpaceFilesMove({
        ...common,
        space: String(space).trim(),
        entryId: String(entryId).trim(),
        folder: opts.folder,
      });
    });
  });

  withSpaceProfileOption(
    withCommonOptions(
      filesCommand
        .command("trash")
        .description("Move a Space file or folder to trash.")
        .argument("<space>", "Space ID (64-character hex)")
        .argument("<entry-id>", "File or folder ID")
    )
  ).action(async (space, entryId, opts, command: Command) => {
    await runFilesCommand(command, opts, "trash", async (common) => {
      await runSpaceFilesTrash({
        ...common,
        space: String(space).trim(),
        entryId: String(entryId).trim(),
      });
    });
  });

  withSpaceProfileOption(
    withCommonOptions(
      filesCommand
        .command("restore")
        .description("Restore a Space file or folder from Trash.")
        .argument("<space>", "Space ID (64-character hex)")
        .argument("<entry-id>", "File or folder ID")
    )
  ).action(async (space, entryId, opts, command: Command) => {
    await runFilesCommand(command, opts, "restore", async (common) => {
      await runSpaceFilesRestore({
        ...common,
        space: String(space).trim(),
        entryId: String(entryId).trim(),
      });
    });
  });

  withSpaceProfileOption(
    withCommonOptions(
      filesCommand
        .command("restore-version")
        .description("Restore an older version as the newest version.")
        .argument("<space>", "Space ID (64-character hex)")
        .argument("<file-id>", "File ID")
        .argument("<revision>", "Version to restore")
        .requiredOption(
          "--base-revision <number>",
          "Current revision before restoring"
        )
    )
  ).action(async (space, fileId, revision, opts, command: Command) => {
    await runFilesCommand(command, opts, "restore-version", async (common) => {
      await runSpaceFilesRestoreVersion({
        ...common,
        space: String(space).trim(),
        fileId: String(fileId).trim(),
        revision: parseRequiredRevision(String(revision), "<revision>"),
        baseRevision: parseRequiredRevision(
          opts.baseRevision,
          "--base-revision"
        ),
      });
    });
  });
}

function withCommonOptions(command: Command): Command {
  return command
    .option("--password <value>", "Space password for protected access")
    .option("--json", "Print canonical JSON", false);
}

async function runFilesCommand(
  command: Command,
  opts: Record<string, unknown>,
  action: string,
  run: (input: {
    baseUrl?: string;
    entryChecksHandled: true;
    json: boolean;
    password?: string;
    profile?: string;
    view?: string;
  }) => Promise<void>
): Promise<void> {
  const cliOptions = resolveSpaceCommandCliOptions(command, opts);
  const view = getGlobalViewOption();
  await runCommandWithEntryChecks({
    routeTokens: ["space", "files", action],
    view,
    profile: cliOptions.profile,
    gatewayUrl: cliOptions.gatewayUrl,
    run: async () => {
      await run({
        profile: cliOptions.profile,
        baseUrl: cliOptions.gatewayUrl,
        password: cliOptions.password,
        json: cliOptions.json === true,
        view,
        entryChecksHandled: true,
      });
    },
  });
}

function parseRevision(
  raw: string | undefined,
  optionName: string
): number | undefined {
  const revision = parseNonNegativeIntegerOption(raw, optionName);
  if (revision === 0) {
    throw new Error(`${optionName} must be at least 1`);
  }
  return revision;
}

function parseRequiredRevision(raw: string, optionName: string): number {
  const revision = parseRevision(raw, optionName);
  if (revision === undefined) {
    throw new Error(`${optionName} is required`);
  }
  return revision;
}
