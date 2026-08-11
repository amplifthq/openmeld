import {
  LOCAL_AGENT_TOOL_ACTIVITY_NAMES,
  resolveCommandAgentWorkActivity,
} from "@openmeld/schemas";
import type {
  AgentWorkActivity,
  LocalAgentToolActivityName,
} from "@openmeld/schemas/types";

export const ADAPTER_TOOL_ACTIVITY_NAMES = LOCAL_AGENT_TOOL_ACTIVITY_NAMES;

export type AdapterToolActivityName = LocalAgentToolActivityName;

export type AdapterToolActivityState =
  | "input-available"
  | "output-available"
  | "output-error";

export type AdapterToolActivityEvent = {
  phase: "tool_activity";
  toolCallId: string;
  toolName: AdapterToolActivityName;
  state: AdapterToolActivityState;
  tsMs: number;
  work?: AgentWorkActivity;
};

const COMMAND_TOOL_NAMES = new Set([
  "bash",
  "command",
  "commandexecution",
  "command_execution",
  "shell",
]);
const READ_TOOL_NAMES = new Set(["read", "readfile", "read_file"]);
const EDIT_TOOL_NAMES = new Set([
  "edit",
  "filechange",
  "file_change",
  "multiedit",
  "notebookedit",
  "notebook_edit",
  "write",
  "writefile",
  "write_file",
]);
const FILE_SEARCH_TOOL_NAMES = new Set([
  "glob",
  "grep",
  "searchfiles",
  "search_files",
]);
const WEB_SEARCH_TOOL_NAMES = new Set([
  "websearch",
  "web_search",
  "web_search_20250305",
  "web_search_20260209",
]);
const WEB_FETCH_TOOL_NAMES = new Set([
  "webfetch",
  "web_fetch",
  "web_fetch_20250910",
  "web_fetch_20260209",
  "web_fetch_20260309",
]);
const DELEGATION_TOOL_NAMES = new Set([
  "agent",
  "collabagenttoolcall",
  "collab_agent_tool_call",
  "task",
]);
const IMAGE_TOOL_NAMES = new Set([
  "imagegeneration",
  "image_generation",
  "imageview",
  "image_view",
]);
const DOCUMENTATION_PATH_PATTERN =
  /(?:^|\/)(?:readme(?:\.[^/]*)?|docs?|developing)(?:\/|$)/u;
const DOCUMENTATION_EXTENSION_PATTERN = /\.(?:md|mdx|rst|txt)$/u;

export function resolveAdapterToolActivityName(
  providerToolName: unknown
): AdapterToolActivityName {
  const normalized = normalizeProviderToolName(providerToolName);
  if (COMMAND_TOOL_NAMES.has(normalized)) {
    return "agent_run_command";
  }
  if (READ_TOOL_NAMES.has(normalized)) {
    return "agent_read_files";
  }
  if (EDIT_TOOL_NAMES.has(normalized)) {
    return "agent_edit_files";
  }
  if (FILE_SEARCH_TOOL_NAMES.has(normalized)) {
    return "agent_search_files";
  }
  if (WEB_SEARCH_TOOL_NAMES.has(normalized)) {
    return "agent_search_web";
  }
  if (WEB_FETCH_TOOL_NAMES.has(normalized)) {
    return "agent_open_webpage";
  }
  if (DELEGATION_TOOL_NAMES.has(normalized)) {
    return "agent_delegate_task";
  }
  if (IMAGE_TOOL_NAMES.has(normalized)) {
    return "agent_work_with_image";
  }
  return "agent_use_tool";
}

export function resolveAdapterToolWorkActivity(
  providerToolName: unknown,
  providerToolInput: unknown
): AgentWorkActivity | null {
  const normalized = normalizeProviderToolName(providerToolName);
  if (COMMAND_TOOL_NAMES.has(normalized)) {
    return resolveCommandAgentWorkActivity(readCommand(providerToolInput));
  }
  if (READ_TOOL_NAMES.has(normalized)) {
    return resolveFileWorkActivity(providerToolInput, "read");
  }
  if (EDIT_TOOL_NAMES.has(normalized)) {
    return resolveFileWorkActivity(providerToolInput, "update");
  }
  if (FILE_SEARCH_TOOL_NAMES.has(normalized)) {
    return { key: "source.search", v: 1 };
  }
  if (WEB_SEARCH_TOOL_NAMES.has(normalized)) {
    return { key: "web.search", v: 1 };
  }
  if (WEB_FETCH_TOOL_NAMES.has(normalized)) {
    return { key: "webpage.read", v: 1 };
  }
  if (DELEGATION_TOOL_NAMES.has(normalized)) {
    return { key: "task.delegate", v: 1 };
  }
  if (normalized === "imagegeneration" || normalized === "image_generation") {
    return { key: "image.generate", v: 1 };
  }
  if (normalized === "imageview" || normalized === "image_view") {
    return { key: "image.inspect", v: 1 };
  }
  return null;
}

function resolveFileWorkActivity(
  input: unknown,
  operation: "read" | "update"
): AgentWorkActivity {
  const path = readFilePath(input)?.toLowerCase() ?? "";
  if (
    DOCUMENTATION_PATH_PATTERN.test(path) ||
    DOCUMENTATION_EXTENSION_PATTERN.test(path)
  ) {
    return {
      key: operation === "read" ? "documentation.read" : "documentation.update",
      v: 1,
    };
  }
  return {
    key: operation === "read" ? "source.read" : "source.update",
    v: 1,
  };
}

function readCommand(value: unknown): string | null {
  const record = toRecord(value);
  const command = record?.command;
  if (typeof command === "string" && command.trim().length > 0) {
    return command;
  }
  if (Array.isArray(command)) {
    const joined = command
      .filter((part): part is string => typeof part === "string")
      .join(" ")
      .trim();
    return joined.length > 0 ? joined : null;
  }
  return null;
}

function readFilePath(value: unknown): string | null {
  const record = toRecord(value);
  for (const candidate of [record?.file_path, record?.filePath, record?.path]) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  if (Array.isArray(record?.changes)) {
    for (const change of record.changes) {
      const path = toRecord(change)?.path;
      if (typeof path === "string" && path.trim().length > 0) {
        return path.trim();
      }
    }
  }
  return null;
}

function normalizeProviderToolName(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
