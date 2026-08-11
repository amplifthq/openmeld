import type { SessionEnv } from "@flue/runtime";
import {
  boolean,
  integer,
  maxValue,
  minLength,
  minValue,
  number,
  optional,
  parse,
  picklist,
  pipe,
  strictObject,
  string,
  trim,
} from "valibot";
import type { RemoteAgentToolDefinition } from "../agent-core/tool-definition";

const MAX_READ_LINES = 2000;
const MAX_READ_CHARS = 50 * 1024;
const MAX_GREP_MATCHES = 100;
const MAX_GREP_LINE_CHARS = 500;
const MAX_GLOB_RESULTS = 1000;
const MAX_COMMAND_TIMEOUT_SECONDS = 300;
const TRAILING_SLASHES_PATTERN = /\/+$/u;
const LEADING_DOT_SLASH_PATTERN = /^\.\//u;

/**
 * Native search surface of the computer workspace. When present, grep
 * runs against the durable filesystem directly instead of shelling out,
 * so results do not depend on the shell backend's command fidelity.
 */
export type RemoteAgentComputerSearch = {
  grep(
    pattern: string,
    path: string,
    options?: { ignoreCase?: boolean }
  ): Promise<{ line: number; path: string; text: string }[]>;
};

/**
 * Backend-aware exec over the computer workspace. When present, bash
 * routes through it so the model can pick the worker-shell isolate or
 * the computerd container against the same file world.
 */
export type RemoteAgentComputerExec = (
  command: string,
  options?: {
    backend?: string;
    cwd?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
  }
) => Promise<{ exitCode: number; stderr: string; stdout: string }>;

export const REMOTE_AGENT_SANDBOX_TOOL_NAMES = [
  "read",
  "write",
  "edit",
  "bash",
  "grep",
  "glob",
] as const;

type RemoteAgentSandboxToolName =
  (typeof REMOTE_AGENT_SANDBOX_TOOL_NAMES)[number];

const readInputSchema = strictObject({
  path: pipe(string(), trim(), minLength(1)),
  offset: optional(pipe(number(), integer(), minValue(1))),
  limit: optional(pipe(number(), integer(), minValue(1), maxValue(2000))),
});

const writeInputSchema = strictObject({
  path: pipe(string(), trim(), minLength(1)),
  content: string(),
});

const editInputSchema = strictObject({
  path: pipe(string(), trim(), minLength(1)),
  oldText: pipe(string(), minLength(1)),
  newText: string(),
  replaceAll: optional(boolean()),
});

const bashInputSchema = strictObject({
  backend: optional(picklist(["worker-shell", "container"])),
  command: pipe(string(), trim(), minLength(1)),
  timeout: optional(
    pipe(
      number(),
      integer(),
      minValue(1),
      maxValue(MAX_COMMAND_TIMEOUT_SECONDS)
    )
  ),
});

const grepInputSchema = strictObject({
  pattern: pipe(string(), minLength(1)),
  path: optional(pipe(string(), trim(), minLength(1))),
  include: optional(pipe(string(), trim(), minLength(1))),
  literal: optional(boolean()),
});

const globInputSchema = strictObject({
  pattern: pipe(string(), trim(), minLength(1)),
  path: optional(pipe(string(), trim(), minLength(1))),
});

export function getRemoteAgentSandboxToolDefinitions(input: {
  env: SessionEnv;
  computerExec?: RemoteAgentComputerExec;
  computerSearch?: RemoteAgentComputerSearch;
  workingDirectory?: string;
}): RemoteAgentToolDefinition<RemoteAgentSandboxToolName>[] {
  return [
    {
      name: "read",
      description:
        "Read a file from your computer (persistent workspace). Output is truncated to 2000 lines or 50KB; use offset and limit for large files.",
      input: readInputSchema,
      execute: async (rawInput) => {
        const request = parse(readInputSchema, rawInput);
        const content = await input.env.readFile(request.path);
        return formatReadResult({
          content,
          limit: request.limit,
          offset: request.offset,
          path: request.path,
        });
      },
    },
    {
      name: "write",
      description:
        "Write content to a file on your computer (persistent workspace). Missing parent directories are created automatically. Files survive across conversations.",
      input: writeInputSchema,
      execute: async (rawInput) => {
        const request = parse(writeInputSchema, rawInput);
        await input.env.writeFile(request.path, request.content);
        return {
          path: request.path,
          sizeBytes: utf8ByteLength(request.content),
          written: true,
        };
      },
    },
    {
      name: "edit",
      description:
        "Edit a file on your computer by exact text replacement. The old text must be unique unless replaceAll is true.",
      input: editInputSchema,
      execute: async (rawInput) => {
        const request = parse(editInputSchema, rawInput);
        const content = await input.env.readFile(request.path);
        const occurrences = countOccurrences(content, request.oldText);
        if (occurrences === 0) {
          throw new Error(
            `Could not find the exact text in ${request.path}. No changes were made.`
          );
        }
        if (!(request.replaceAll || occurrences === 1)) {
          throw new Error(
            `Found ${occurrences} occurrences in ${request.path}. Provide more surrounding context or set replaceAll to true.`
          );
        }
        const updated = request.replaceAll
          ? content.replaceAll(request.oldText, request.newText)
          : content.replace(request.oldText, request.newText);
        await input.env.writeFile(request.path, updated);
        return {
          path: request.path,
          replacements: request.replaceAll ? occurrences : 1,
        };
      },
    },
    {
      name: "bash",
      description:
        'Run a shell command on your computer. Both backends operate on the same persistent files. Default backend "worker-shell" is instant text tooling in an isolate: cat, ls, grep, sed, awk, sort, head, tail, find, wc — no npm, node, python, package managers, or network. Pass backend "container" when the command needs a real Linux userland (python3, git, curl, jq, real binaries); it is slower to start because the container must boot, so prefer worker-shell when it can do the job. Returns bounded stdout, stderr, and the exit code.',
      input: bashInputSchema,
      execute: async (rawInput, options) => {
        const request = parse(bashInputSchema, rawInput);
        const execOptions = {
          signal: options?.signal,
          ...(request.timeout === undefined
            ? {}
            : { timeoutMs: request.timeout * 1000 }),
        };
        const result = input.computerExec
          ? await input.computerExec(request.command, {
              ...execOptions,
              backend: request.backend,
              cwd: input.workingDirectory,
            })
          : await input.env.exec(request.command, execOptions);
        return {
          exitCode: result.exitCode,
          stderr: truncateTail(result.stderr),
          stdout: truncateTail(result.stdout),
        };
      },
    },
    {
      name: "grep",
      description:
        "Search file contents on your computer for a regex or literal pattern. Returns matching paths, line numbers, and text.",
      input: grepInputSchema,
      execute: async (rawInput, options) => {
        const request = parse(grepInputSchema, rawInput);
        if (input.computerSearch) {
          return await runComputerGrep({
            request,
            search: input.computerSearch,
            workingDirectory: input.workingDirectory ?? "/",
          });
        }
        return await runShellGrep({
          env: input.env,
          request,
          signal: options?.signal,
        });
      },
    },
    {
      name: "glob",
      description:
        "Find files on your computer by filename pattern using shell find -name semantics.",
      input: globInputSchema,
      execute: async (rawInput, options) => {
        const request = parse(globInputSchema, rawInput);
        const command = `find ${shellQuote(request.path ?? ".")} -type f -name ${shellQuote(request.pattern)} 2>/dev/null | head -${MAX_GLOB_RESULTS}`;
        const result = await input.env.exec(command, {
          signal: options?.signal,
        });
        if (result.exitCode !== 0 && !result.stdout.trim()) {
          return { paths: [] };
        }
        return {
          paths: result.stdout.trim().split("\n").filter(Boolean),
        };
      },
    },
  ];
}

async function runShellGrep(input: {
  env: SessionEnv;
  request: {
    include?: string;
    literal?: boolean;
    path?: string;
    pattern: string;
  };
  signal?: AbortSignal;
}): Promise<{ matches: string[]; truncated: boolean }> {
  const { request } = input;
  const backend = await resolveGrepBackend(input.env, input.signal);
  const searchPath = request.path ?? ".";
  const command =
    backend === "rg"
      ? `rg --line-number --with-filename --color never${request.literal ? " --fixed-strings" : ""}${request.include ? ` --glob ${shellQuote(request.include)}` : ""} -- ${shellQuote(request.pattern)} ${shellQuote(searchPath)}`
      : `grep -rnH ${request.literal ? "-F" : "-E"}${request.include ? ` --include=${shellQuote(request.include)}` : ""} -- ${shellQuote(request.pattern)} ${shellQuote(searchPath)}`;
  const result = await input.env.exec(command, {
    signal: input.signal,
  });
  if (result.exitCode === 1 && !result.stdout.trim()) {
    return { matches: [], truncated: false };
  }
  if (result.exitCode > 1) {
    throw new Error(`Sandbox grep failed: ${result.stderr}`);
  }
  const allMatches = result.stdout.trim().split("\n").filter(Boolean);
  return {
    matches: allMatches
      .slice(0, MAX_GREP_MATCHES)
      .map((line) => line.slice(0, MAX_GREP_LINE_CHARS)),
    truncated: allMatches.length > MAX_GREP_MATCHES,
  };
}

async function runComputerGrep(input: {
  request: {
    include?: string;
    literal?: boolean;
    path?: string;
    pattern: string;
  };
  search: RemoteAgentComputerSearch;
  workingDirectory: string;
}): Promise<{ matches: string[]; truncated: boolean }> {
  const searchPath = resolveComputerPath(
    input.request.path,
    input.workingDirectory
  );
  const pattern = input.request.literal
    ? escapeRegExp(input.request.pattern)
    : input.request.pattern;
  const includeFilter = input.request.include
    ? globToRegExp(input.request.include)
    : null;
  const allMatches = (await input.search.grep(pattern, searchPath)).filter(
    (match) => !includeFilter || includeFilter.test(baseName(match.path))
  );
  return {
    matches: allMatches
      .slice(0, MAX_GREP_MATCHES)
      .map((match) =>
        `${match.path}:${match.line}:${match.text}`.slice(
          0,
          MAX_GREP_LINE_CHARS
        )
      ),
    truncated: allMatches.length > MAX_GREP_MATCHES,
  };
}

function resolveComputerPath(
  path: string | undefined,
  workingDirectory: string
): string {
  if (!path || path === ".") {
    return workingDirectory;
  }
  if (path.startsWith("/")) {
    return path;
  }
  return `${workingDirectory.replace(TRAILING_SLASHES_PATTERN, "")}/${path.replace(LEADING_DOT_SLASH_PATTERN, "")}`;
}

function baseName(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? path : path.slice(index + 1);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function globToRegExp(glob: string): RegExp {
  const source = glob
    .split("*")
    .map((part) => escapeRegExp(part))
    .join(".*");
  return new RegExp(`^${source}$`, "u");
}

async function resolveGrepBackend(
  env: SessionEnv,
  signal?: AbortSignal
): Promise<"grep" | "rg"> {
  try {
    const result = await env.exec("rg --version", {
      signal,
      timeoutMs: 10_000,
    });
    return result.exitCode === 0 ? "rg" : "grep";
  } catch {
    return "grep";
  }
}

function formatReadResult(input: {
  content: string;
  limit?: number;
  offset?: number;
  path: string;
}) {
  const lines = input.content.split("\n");
  const start = input.offset ? input.offset - 1 : 0;
  if (start >= lines.length) {
    throw new Error(
      `Offset ${input.offset} is beyond the end of ${input.path} (${lines.length} lines).`
    );
  }
  const requested = lines.slice(
    start,
    input.limit === undefined ? undefined : start + input.limit
  );
  const shown: string[] = [];
  let characters = 0;
  for (const line of requested) {
    const nextCharacters = line.length + (shown.length === 0 ? 0 : 1);
    if (
      shown.length >= MAX_READ_LINES ||
      characters + nextCharacters > MAX_READ_CHARS
    ) {
      break;
    }
    shown.push(line);
    characters += nextCharacters;
  }
  return {
    content: shown.join("\n"),
    nextOffset:
      shown.length < requested.length ? start + shown.length + 1 : null,
    path: input.path,
    totalLines: lines.length,
    truncated: shown.length < requested.length,
  };
}

function countOccurrences(value: string, search: string): number {
  let count = 0;
  let position = value.indexOf(search);
  while (position !== -1) {
    count += 1;
    position = value.indexOf(search, position + search.length);
  }
  return count;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function truncateTail(value: string): string {
  if (value.length <= MAX_READ_CHARS) {
    const lines = value.split("\n");
    return lines.length <= MAX_READ_LINES
      ? value
      : lines.slice(-MAX_READ_LINES).join("\n");
  }
  const tail = value.slice(-MAX_READ_CHARS);
  return tail.split("\n").slice(-MAX_READ_LINES).join("\n");
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
