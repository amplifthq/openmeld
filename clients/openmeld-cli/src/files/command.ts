import { randomUUID } from "node:crypto";
import { openAsBlob } from "node:fs";
import { basename } from "node:path";
import { createFileRootApi } from "@openmeld/api-client";
import {
  isSpaceFileTextEditable,
  resolveSpaceFileMimeType,
  SPACE_FILE_MAX_SIZE_BYTES,
} from "@openmeld/schemas";
import type {
  FileRootEntry,
  ListFileRootResponse,
} from "@openmeld/schemas/types";
import type { Command } from "commander";
import { getAuthSessionState } from "../config/auth-session";
import { resolveBaseUrl } from "../config/base-url";
import { resolveRuntimeContext } from "../runtime/context";
import type { Presenter } from "../runtime/presenter";
import { createPresenter } from "../runtime/presenter";
import { createCliApiClientFoundation } from "../space/api-client-foundation";
import { outJsonLine } from "../ui/io";
import { saveFileDownload } from "./download";

type Location = "team" | "my";
type FileRootApi = ReturnType<typeof createFileRootApi>;

function location(value: string): Location {
  if (value === "team" || value === "my") {
    return value;
  }
  throw new Error("Choose --location team or --location my.");
}

function folder(value: string | undefined): string | null {
  const id = value?.trim();
  return !id || id === "root" ? null : id;
}

function revision(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error("--revision must be a positive whole number.");
  }
  return parsed;
}

async function withFiles(input: {
  command: Command;
  json: boolean;
  location: string;
  run: (context: {
    api: FileRootApi;
    location: Location;
    output: (code: string, value: unknown, human: () => void) => void;
    presenter: ReturnType<typeof createPresenter>;
  }) => Promise<void>;
}): Promise<void> {
  const targetLocation = location(input.location);
  const runtime = await resolveRuntimeContext({
    view: input.command.optsWithGlobals().view,
  });
  const presenter = createPresenter(runtime);
  const auth = await getAuthSessionState({ validateRemote: true });
  const organization = auth.session?.activeOrganization;
  if (auth.state !== "valid" || !organization) {
    throw new Error(
      "Sign in and choose an active Team before using Files. Run `openmeld login`, then `openmeld org switch <slug>`."
    );
  }
  const api = createFileRootApi(
    createCliApiClientFoundation(await resolveBaseUrl(), {
      organizationId: organization.id,
    })
  );
  await input.run({
    api,
    location: targetLocation,
    presenter,
    output: (code, value, human) => {
      if (input.json) {
        outJsonLine(value);
      } else if (presenter.view === "agent") {
        presenter.data({ code, payload: value });
      } else {
        human();
      }
    },
  });
}

function showEntry(entry: FileRootEntry): string {
  return entry.kind === "folder"
    ? `[folder] ${entry.name}  id=${entry.id}`
    : `[file] ${entry.name}  revision=${entry.latestRevision.revision}  size=${entry.latestRevision.sizeBytes}  id=${entry.id}`;
}

function showList(input: {
  location: Location;
  presenter: Presenter;
  result: ListFileRootResponse;
}): void {
  input.presenter.line({
    code: "files.list.location",
    text: `${input.location === "team" ? "Team files" : "My files"} / ${input.result.breadcrumbs.map((item) => item.name).join(" / ")}:`,
  });
  for (const entry of input.result.entries) {
    input.presenter.line({
      code: "files.list.entry",
      text: showEntry(entry),
      data: { entry },
    });
  }
  if (input.result.entries.length === 0) {
    input.presenter.line({
      code: "files.list.empty",
      text:
        input.result.view === "trash"
          ? "Trash is empty."
          : "This folder is empty.",
    });
  }
}

export function registerFilesCommands(
  program: Command,
  runChecked: (routeTokens: string[], run: () => Promise<void>) => Promise<void>
): void {
  const files = program
    .command("files")
    .description("Work with Team files or your private files.");

  files
    .command("list")
    .description("List a Files location or folder.")
    .requiredOption("--location <team|my>", "Team files or My files")
    .option("--folder <id>", "Folder ID, or root", "root")
    .option("--trash", "List Trash", false)
    .option("--json", "Print canonical JSON", false)
    .action(async (opts, command: Command) => {
      await runChecked(["files", "list"], async () => {
        await withFiles({
          command,
          json: opts.json === true,
          location: opts.location,
          run: async ({ api, location: target, output, presenter }) => {
            const result = await api.list({
              location: target,
              parentId: folder(opts.folder),
              view: opts.trash ? "trash" : "active",
            });
            output("files.list", result, () =>
              showList({ location: target, presenter, result })
            );
          },
        });
      });
    });

  files
    .command("read")
    .description("Print a text file, optionally at an exact revision.")
    .argument("<file-id>", "File ID")
    .requiredOption("--location <team|my>", "Team files or My files")
    .option("--revision <number>", "Exact revision")
    .option("--json", "Print canonical JSON", false)
    .action(async (fileId: string, opts, command: Command) => {
      await runChecked(["files", "read"], async () => {
        await withFiles({
          command,
          json: opts.json === true,
          location: opts.location,
          run: async ({ api, location: target, output, presenter }) => {
            const [file, content] = await Promise.all([
              api.getFile({ location: target, fileId }),
              api.download({
                location: target,
                fileId,
                revision: revision(opts.revision),
              }),
            ]);
            if (
              !isSpaceFileTextEditable({
                mimeType: content.mimeType,
                sizeBytes: content.bytes.byteLength,
              })
            ) {
              throw new Error(
                "This file is binary or too large to print. Open it in Files."
              );
            }
            const result = {
              file,
              revision: content.revision,
              content: new TextDecoder("utf-8", { fatal: true }).decode(
                content.bytes
              ),
            };
            output("files.read", result, () =>
              presenter.line({ code: "files.read", text: result.content })
            );
          },
        });
      });
    });

  files
    .command("history")
    .description("List saved revisions of a file.")
    .argument("<file-id>", "File ID")
    .requiredOption("--location <team|my>", "Team files or My files")
    .option("--json", "Print canonical JSON", false)
    .action(async (fileId: string, opts, command: Command) => {
      await runChecked(["files", "history"], async () => {
        await withFiles({
          command,
          json: opts.json === true,
          location: opts.location,
          run: async ({ api, location: target, output, presenter }) => {
            const result = await api.listRevisions({
              location: target,
              fileId,
            });
            output("files.history", result, () => {
              presenter.line({
                code: "files.history.file",
                text: `Version history for ${result.file.path}:`,
              });
              for (const item of result.revisions) {
                presenter.line({
                  code: "files.history.revision",
                  text: `Version ${item.revision}  ${item.createdAt}  ${item.sizeBytes} bytes`,
                });
              }
            });
          },
        });
      });
    });

  files
    .command("copy")
    .description("Copy one saved revision between Team files and My files.")
    .argument("<file-id>", "Source file ID")
    .requiredOption("--source-location <team|my>", "Where the source file is")
    .requiredOption("--location <team|my>", "Destination Files location")
    .requiredOption("--revision <number>", "Exact source revision to copy")
    .option("--folder <id>", "Destination folder ID, or root", "root")
    .option("--name <name>", "Name for the new copy")
    .option("--json", "Print canonical JSON", false)
    .action(async (fileId: string, opts, command: Command) => {
      await runChecked(["files", "copy"], async () => {
        await withFiles({
          command,
          json: opts.json === true,
          location: opts.location,
          run: async ({ api, location: destination, output, presenter }) => {
            const sourceLocation = location(opts.sourceLocation);
            const sourceRevision = revision(opts.revision);
            if (sourceRevision === undefined) {
              throw new Error("--revision is required.");
            }
            const source = await api.getFile({
              location: sourceLocation,
              fileId,
            });
            const result = await api.copyRevision({
              location: destination,
              body: {
                sourceLocation,
                sourceFileId: fileId,
                sourceRevision,
                name: opts.name?.trim() || source.name,
                parentId: folder(opts.folder),
                clientMutationId: randomUUID(),
              },
            });
            output("files.copy", result, () =>
              presenter.line({
                code: "files.copied",
                text: `Copied revision ${sourceRevision} to ${destination === "team" ? "Team files" : "My files"} as ${result.file.path}.`,
              })
            );
          },
        });
      });
    });

  files
    .command("copy-to-space")
    .description("Copy one saved Team or My file revision into a Space.")
    .argument("<file-id>", "Source file ID")
    .requiredOption("--source-location <team|my>", "Where the source file is")
    .requiredOption("--space <id>", "Destination Space ID")
    .requiredOption("--revision <number>", "Exact source revision to copy")
    .option("--folder <id>", "Destination folder ID, or root", "root")
    .option("--name <name>", "Name for the new copy")
    .option("--json", "Print canonical JSON", false)
    .action(async (fileId: string, opts, command: Command) => {
      await runChecked(["files", "copy-to-space"], async () => {
        await withFiles({
          command,
          json: opts.json === true,
          location: opts.sourceLocation,
          run: async ({ api, location: sourceLocation, output, presenter }) => {
            const sourceRevision = revision(opts.revision);
            if (sourceRevision === undefined) {
              throw new Error("--revision is required.");
            }
            const source = await api.getFile({
              location: sourceLocation,
              fileId,
            });
            const spaceId = opts.space?.trim();
            if (!spaceId) {
              throw new Error("Choose a destination Space ID with --space.");
            }
            const result = await api.copyToSpace({
              spaceId,
              body: {
                sourceLocation,
                sourceFileId: fileId,
                sourceRevision,
                name: opts.name?.trim() || source.name,
                parentId: folder(opts.folder),
                clientMutationId: randomUUID(),
              },
            });
            output("files.copy_to_space", { file: result, spaceId }, () =>
              presenter.line({
                code: "files.copied_to_space",
                text: `Copied revision ${sourceRevision} to Space ${spaceId} as ${result.path}.`,
              })
            );
          },
        });
      });
    });

  files
    .command("upload")
    .description("Upload a local file to Team files or My files.")
    .argument("<file>", "Local file path")
    .requiredOption("--location <team|my>", "Team files or My files")
    .option("--folder <id>", "Destination folder ID, or root", "root")
    .option("--name <name>", "Name shown in Files")
    .option("--type <mime-type>", "File media type")
    .option("--json", "Print canonical JSON", false)
    .action(async (path: string, opts, command: Command) => {
      await runChecked(["files", "upload"], async () => {
        await withFiles({
          command,
          json: opts.json === true,
          location: opts.location,
          run: async ({ api, location: target, output, presenter }) => {
            const bytes = await openAsBlob(path);
            if (bytes.size > SPACE_FILE_MAX_SIZE_BYTES) {
              throw new Error("This file is too large for Files.");
            }
            const result = await api.upload({
              location: target,
              bytes,
              name: opts.name?.trim() || basename(path),
              parentId: folder(opts.folder),
              mimeType: resolveSpaceFileMimeType({
                declaredMimeType: opts.type,
                fileName: path,
              }),
              clientMutationId: randomUUID(),
            });
            output("files.upload", { file: result }, () =>
              presenter.line({
                code: "files.uploaded",
                text: `Uploaded ${result.path} (revision ${result.latestRevision.revision}).`,
              })
            );
          },
        });
      });
    });

  files
    .command("write")
    .description("Save a new file revision after reading the current one.")
    .argument("<file-id>", "File ID")
    .requiredOption("--location <team|my>", "Team files or My files")
    .requiredOption("--base-revision <number>", "Revision being replaced")
    .requiredOption("--file <path>", "Local file with the replacement content")
    .option("--type <mime-type>", "File media type")
    .option("--json", "Print canonical JSON", false)
    .action(async (fileId: string, opts, command: Command) => {
      await runChecked(["files", "write"], async () => {
        await withFiles({
          command,
          json: opts.json === true,
          location: opts.location,
          run: async ({ api, location: target, output, presenter }) => {
            const baseRevision = revision(opts.baseRevision);
            if (baseRevision === undefined) {
              throw new Error("--base-revision is required.");
            }
            const bytes = await openAsBlob(opts.file);
            if (bytes.size > SPACE_FILE_MAX_SIZE_BYTES) {
              throw new Error("This file is too large for Files.");
            }
            const file = await api.updateContent({
              location: target,
              fileId,
              bytes,
              mimeType: resolveSpaceFileMimeType({
                declaredMimeType: opts.type,
                fileName: opts.file,
              }),
              baseRevision,
              clientMutationId: randomUUID(),
            });
            output("files.write", { file }, () =>
              presenter.line({
                code: "files.updated",
                text: `Saved ${file.path} as revision ${file.latestRevision.revision}.`,
              })
            );
          },
        });
      });
    });

  files
    .command("download")
    .description(
      "Save a file revision to a local path, including binary files."
    )
    .argument("<file-id>", "File ID")
    .requiredOption("--location <team|my>", "Team files or My files")
    .requiredOption("--output <path>", "Local destination path")
    .option("--revision <number>", "Exact revision")
    .option("--force", "Replace an existing local file", false)
    .option("--json", "Print canonical JSON", false)
    .action(async (fileId: string, opts, command: Command) => {
      await runChecked(["files", "download"], async () => {
        await withFiles({
          command,
          json: opts.json === true,
          location: opts.location,
          run: async ({ api, location: target, output, presenter }) => {
            const content = await api.streamContent({
              location: target,
              fileId,
              revision: revision(opts.revision),
            });
            const destination = String(opts.output);
            const received = await saveFileDownload({
              bytes: content.bytes,
              destination,
              force: opts.force === true,
              sizeBytes: content.sizeBytes,
            });
            const result = {
              output: destination,
              revision: content.revision,
              mimeType: content.mimeType,
              sizeBytes: received,
            };
            output("files.download", result, () =>
              presenter.line({
                code: "files.downloaded",
                text: `Downloaded revision ${content.revision} to ${destination}.`,
              })
            );
          },
        });
      });
    });
}
