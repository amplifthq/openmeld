import type {
  AdapterComputerFileAccessBoundary,
  AdapterDispatchExecutionMode,
  AdapterDispatchFailure,
  AgentControllerPermissionMode,
} from "@openmeld/adapter-core";

const PROFILE_NAME = "openmeld_computer_boundary";
const TRAILING_PATH_SEPARATORS_PATTERN = /[\\/]+$/u;

type CodexPermissionMode = Extract<
  AgentControllerPermissionMode,
  `codex:${string}`
>;

export function redactCodexFileAccessBoundaryDispatchFailure(
  failure: AdapterDispatchFailure
): AdapterDispatchFailure {
  const errorCode = failure.errorCode ?? "upstream_unreachable";
  return {
    ...(failure.diagnostics ? { diagnostics: failure.diagnostics } : {}),
    errorCode,
    errorMessage: `${errorCode}: Codex failed while the Computer file access boundary was active. Local controller output was withheld because it may contain private folder paths.`,
    errorType: failure.errorType,
    ...(failure.providerAccessEvidence
      ? { providerAccessEvidence: failure.providerAccessEvidence }
      : {}),
    status: "failed",
    ...(failure.telemetry ? { telemetry: failure.telemetry } : {}),
  };
}

export function buildCodexFileAccessBoundaryGlobalArgs(input: {
  boundary: AdapterComputerFileAccessBoundary;
  executionMode?: AdapterDispatchExecutionMode;
  permissionMode?: AgentControllerPermissionMode;
}): string[] {
  const permissionMode = resolveCodexPermissionMode(input.permissionMode);
  if (permissionMode === "codex:customConfig") {
    throw new Error(
      "computer.file_access.unverified: Codex custom configuration cannot be safely intersected with the Computer file access boundary"
    );
  }

  return [
    "--strict-config",
    "-c",
    buildPermissionProfile({
      boundary: input.boundary,
      executionMode: input.executionMode,
      permissionMode,
    }),
    "-c",
    `default_permissions=${tomlString(PROFILE_NAME)}`,
    ...buildApprovalArgs({
      executionMode: input.executionMode,
      permissionMode,
    }),
  ];
}

function buildPermissionProfile(input: {
  boundary: AdapterComputerFileAccessBoundary;
  executionMode?: AdapterDispatchExecutionMode;
  permissionMode: CodexPermissionMode;
}): string {
  const fileAccess = resolveFileAccess(input);
  const fields = [
    ...(fileAccess.extendsProfile
      ? [`extends = ${tomlString(fileAccess.extendsProfile)}`]
      : []),
    `filesystem = { ${fileAccess.filesystemEntries.join(", ")} }`,
    ...(fileAccess.fullNetwork
      ? ['network = { enabled = true, mode = "full" }']
      : []),
  ];
  return `permissions.${PROFILE_NAME}={ ${fields.join(", ")} }`;
}

function resolveFileAccess(input: {
  boundary: AdapterComputerFileAccessBoundary;
  executionMode?: AdapterDispatchExecutionMode;
  permissionMode: CodexPermissionMode;
}): {
  extendsProfile: ":read-only" | ":workspace" | null;
  filesystemEntries: string[];
  fullNetwork: boolean;
} {
  const isRepair = input.executionMode === "repair";
  const isFullAccess = !isRepair && input.permissionMode === "codex:fullAccess";
  const selectedFolderAccess = isFullAccess ? "write" : "read";
  const extendsProfile = resolveBaseProfile({ isFullAccess, isRepair });

  if (input.boundary.mode === "only_selected_folders") {
    return {
      extendsProfile,
      filesystemEntries: [
        '":root" = "deny"',
        ...buildFolderEntries(input.boundary.folders, selectedFolderAccess),
      ],
      fullNetwork: isFullAccess,
    };
  }

  return {
    extendsProfile,
    filesystemEntries: [
      ...(isFullAccess ? ['":root" = "write"'] : []),
      ...buildFolderEntries(input.boundary.folders, "deny"),
    ],
    fullNetwork: isFullAccess,
  };
}

function resolveBaseProfile(input: {
  isFullAccess: boolean;
  isRepair: boolean;
}): ":read-only" | ":workspace" | null {
  if (input.isRepair) {
    return ":read-only";
  }
  return input.isFullAccess ? null : ":workspace";
}

function buildFolderEntries(
  folders: readonly string[],
  access: "deny" | "read" | "write"
): string[] {
  return folders.flatMap((folder) => [
    `${tomlString(folder)} = ${tomlString(access)}`,
    `${tomlString(toDescendantPattern(folder))} = ${tomlString(access)}`,
  ]);
}

function toDescendantPattern(folder: string): string {
  const withoutTrailingSeparators = folder.replace(
    TRAILING_PATH_SEPARATORS_PATTERN,
    ""
  );
  if (withoutTrailingSeparators.length === 0) {
    return "/**";
  }
  return `${withoutTrailingSeparators}/**`;
}

function buildApprovalArgs(input: {
  executionMode?: AdapterDispatchExecutionMode;
  permissionMode: CodexPermissionMode;
}): string[] {
  if (input.executionMode === "repair") {
    return ["-a", "untrusted"];
  }
  if (input.permissionMode === "codex:fullAccess") {
    return ["-a", "never"];
  }
  if (input.permissionMode === "codex:approveForMe") {
    return ["-a", "on-request", "-c", 'approvals_reviewer="auto_review"'];
  }
  return ["-a", "untrusted"];
}

function resolveCodexPermissionMode(value: unknown): CodexPermissionMode {
  switch (value) {
    case "codex:approveForMe":
    case "codex:fullAccess":
    case "codex:customConfig":
      return value;
    default:
      return "codex:askForApproval";
  }
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}
