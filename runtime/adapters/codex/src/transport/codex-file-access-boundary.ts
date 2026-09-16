import type {
  AdapterComputerFileAccessBoundary,
  AdapterDispatchExecutionMode,
  AdapterDispatchFailure,
  AgentControllerPermissionMode,
} from "@openmeld/adapter-core";

export const CODEX_FILE_ACCESS_PERMISSION_PROFILE =
  "openmeld_computer_boundary";
const PROFILE_NAME = CODEX_FILE_ACCESS_PERMISSION_PROFILE;
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
    // Scratch tasks do not inherit a surrounding project's AGENTS.md. An empty
    // marker list makes their cwd the project root without disabling global docs.
    ...(input.boundary.executionContextAccess === "space_context"
      ? ["-c", "project_root_markers=[]"]
      : []),
    ...(input.boundary.executionContextAccess
      ? [
          "-c",
          "features.hooks=false",
          "-c",
          "features.plugins=false",
          "-c",
          "features.apps=false",
          "-c",
          "features.computer_use=false",
          "-c",
          "features.browser_use=false",
          "-c",
          "features.browser_use_external=false",
          "-c",
          "features.in_app_browser=false",
          "-c",
          "features.skill_mcp_dependency_install=false",
        ]
      : ["--strict-config"]),
    "-c",
    buildPermissionProfile({
      boundary: input.boundary,
      executionMode: input.executionMode,
      permissionMode,
    }),
    "-c",
    `default_permissions=${tomlString(PROFILE_NAME)}`,
    ...(input.boundary.executionContextAccess
      ? ["-a", "never"]
      : buildApprovalArgs({
          executionMode: input.executionMode,
          permissionMode,
        })),
  ];
}

// The native thread response confirms the selected permission profile before
// a turn can run. CLI --version alone cannot attest to effective file access.
export function isCodexExecutionContextFileAccessConfirmed(
  value: unknown,
  boundary: AdapterComputerFileAccessBoundary,
  workingDirectory: string,
  executionMode?: AdapterDispatchExecutionMode
): boolean {
  if (!boundary.executionContextAccess) {
    return true;
  }
  const response = recordValue(value);
  const profile = recordValue(response?.activePermissionProfile);
  const sandbox = recordValue(response?.sandbox);
  const roots = response?.runtimeWorkspaceRoots;
  if (
    !Array.isArray(roots) ||
    roots.length !== 1 ||
    roots[0] !== workingDirectory
  ) {
    return false;
  }
  if (
    profile?.id !== PROFILE_NAME ||
    profile.extends != null ||
    response?.cwd !== workingDirectory ||
    response.approvalPolicy !== "never"
  ) {
    return false;
  }
  if (
    resolveCodexExecutionContextAccess(boundary, executionMode) !== "workspace"
  ) {
    return sandbox?.type === "readOnly";
  }
  return (
    sandbox?.type === "workspaceWrite" &&
    sandbox.excludeTmpdirEnvVar === true &&
    sandbox.excludeSlashTmp === true &&
    Array.isArray(sandbox.writableRoots) &&
    sandbox.writableRoots.every(
      (root) => typeof root === "string" && boundary.folders.includes(root)
    )
  );
}

export function resolveCodexExecutionContextAccess(
  boundary: AdapterComputerFileAccessBoundary,
  executionMode?: AdapterDispatchExecutionMode
): AdapterComputerFileAccessBoundary["executionContextAccess"] {
  return executionMode === "repair" &&
    boundary.executionContextAccess === "workspace"
    ? "read_only"
    : boundary.executionContextAccess;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
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
  if (input.boundary.executionContextAccess) {
    if (input.boundary.mode !== "only_selected_folders") {
      throw new Error("execution_context.file_access_unverified");
    }
    return {
      extendsProfile: null,
      filesystemEntries: [
        '":root" = "deny"',
        '":minimal" = "read"',
        ...buildFolderEntries(
          input.boundary.folders,
          resolveCodexExecutionContextAccess(
            input.boundary,
            input.executionMode
          ) === "workspace"
            ? "write"
            : "read"
        ),
      ],
      fullNetwork: !isRepair && input.permissionMode === "codex:fullAccess",
    };
  }
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
