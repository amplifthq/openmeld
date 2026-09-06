import type {
  CenterAgentContextLoadSelection,
  CreateCenterAgentContextLoadReceiptResponse,
  CreateCenterAgentContextManifestResponse,
} from "@openmeld/schemas/types";
import type { Presenter } from "../runtime/presenter/types";
import type { RuntimeContext } from "../runtime/types";
import { renderInfoCard } from "../ui/info-card";
import {
  type CenterAgentOrganizationScope,
  createCenterAgentApiClient,
  resolveTargetedCenterAgentCommandContext,
} from "./command-context";
import { emitCenterAgentApiError, emitCenterAgentCommandError } from "./errors";
import { resolveCenterAgentLocalSource } from "./interaction-source";
import { formatOrganizationLabel } from "./presentation";

const CENTER_AGENT_CONTEXT_MATERIALIZED_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const POSIX_SHELL_UNQUOTED_ARGUMENT_PATTERN = /^[A-Za-z0-9._:/-]+$/u;

export async function runCenterAgentContext(input: {
  cursor?: string;
  limit?: number;
  maxContextTokens?: number;
  organization?: string;
  sessionId?: string;
  spaceId?: string;
  via?: string;
  view?: string;
}): Promise<void> {
  const context = await resolveTargetedCenterAgentCommandContext(input);
  if (!context) {
    return;
  }
  const source = resolveCenterAgentLocalSource(input);
  if (!source) {
    emitCenterAgentCommandError({
      activeOrganization: context.organizationScope.target,
      code: "center_agent.context_source_invalid",
      message:
        "The Local Agent source must include a client name up to 80 characters and an optional session ID up to 512 characters.",
      nextStep:
        "Retry from Codex or Claude Code, or pass a short client name with `--via`.",
      presenter: context.presenter,
      title: "Local Agent Source Invalid",
    });
    return;
  }

  try {
    const api = await createCenterAgentApiClient({
      organizationId: context.organizationScope.target.id,
    });
    const response = await api.createContextManifest({
      ...(input.spaceId === undefined ? {} : { spaceId: input.spaceId }),
      ...(input.cursor ? { cursor: input.cursor } : {}),
      ...(input.limit === undefined ? {} : { limit: input.limit }),
      ...(input.maxContextTokens === undefined
        ? {}
        : { maxContextTokens: input.maxContextTokens }),
      source,
    });
    emitCenterAgentContextSuccess({
      organizationScope: context.organizationScope,
      presenter: context.presenter,
      response,
      runtime: context.runtime,
      viaOverride: input.via,
    });
  } catch (error) {
    emitCenterAgentApiError({
      activeOrganization: context.organizationScope.target,
      error,
      operation: "context",
      presenter: context.presenter,
    });
  }
}

export async function runCenterAgentContextReceipt(input: {
  all?: boolean;
  entries?: readonly string[];
  manifestId?: string;
  organization?: string;
  sessionId?: string;
  via?: string;
  view?: string;
}): Promise<void> {
  const context = await resolveTargetedCenterAgentCommandContext(input);
  if (!context) {
    return;
  }
  const manifestId = String(input.manifestId ?? "").trim();
  const selection = resolveCenterAgentContextLoadSelectionInput(input);
  if (!(manifestId && selection)) {
    emitCenterAgentCommandError({
      activeOrganization: context.organizationScope.target,
      code: "center_agent.context_receipt_invalid",
      message:
        "Choose exactly what the Local Agent added to its working context.",
      nextStep:
        "Use `--all` for the complete manifest, or repeat `--entry '<source-ref-id>=<materialized-content-hash>'` for an exact subset.",
      presenter: context.presenter,
      title: "Context Load Selection Needed",
    });
    return;
  }
  const source = resolveCenterAgentLocalSource(input);
  if (!source) {
    emitCenterAgentCommandError({
      activeOrganization: context.organizationScope.target,
      code: "center_agent.context_receipt_source_invalid",
      message:
        "The Local Agent source must include a client name up to 80 characters and an optional session ID up to 512 characters.",
      nextStep: "Retry from the same Local Agent that requested this context.",
      presenter: context.presenter,
      title: "Local Agent Source Invalid",
    });
    return;
  }

  try {
    const api = await createCenterAgentApiClient({
      organizationId: context.organizationScope.target.id,
    });
    const response = await api.createContextLoadReceipt({
      manifestId,
      selection,
      source,
    });
    emitCenterAgentContextReceiptSuccess({
      organizationScope: context.organizationScope,
      presenter: context.presenter,
      response,
      runtime: context.runtime,
    });
  } catch (error) {
    emitCenterAgentApiError({
      activeOrganization: context.organizationScope.target,
      error,
      operation: "context_receipt",
      presenter: context.presenter,
    });
  }
}

function emitCenterAgentContextSuccess(input: {
  organizationScope: CenterAgentOrganizationScope;
  presenter: Presenter;
  response: CreateCenterAgentContextManifestResponse;
  runtime: RuntimeContext;
  viaOverride?: string;
}): void {
  const payload = {
    status: "ok",
    organization: input.organizationScope,
    manifest: input.response,
    nextAction:
      input.response.entries.length > 0
        ? {
            command: buildCenterAgentContextReceiptCommand({
              manifestId: input.response.manifestId,
              organizationSlug: input.organizationScope.target.slug,
              viaOverride: input.viaOverride,
            }),
            kind: "record_context_load" as const,
            runAfter: "all_manifest_entries_added_to_working_context" as const,
          }
        : null,
  };
  if (input.runtime.resolvedView === "agent") {
    input.presenter.data({ code: "center_agent.context", payload });
    return;
  }
  renderInfoCard({
    codePrefix: "center-agent.context.card",
    minContentWidth: 72,
    presenter: input.presenter,
    rows: [
      {
        label: "Organization",
        value: formatOrganizationLabel(input.organizationScope.target),
      },
      {
        label: "Messages",
        value: String(input.response.budget.includedMessages),
      },
      {
        label: "Estimated Context Tokens",
        value: `${input.response.budget.estimatedTokens} of ${input.response.budget.requestedTokens}`,
      },
      ...input.response.entries.map((entry) => ({
        label: `${entry.author.profileName} · ${entry.occurredAt}`,
        value: entry.content.text,
      })),
      ...(input.response.continuation.cursor
        ? [
            {
              label: "Older Messages",
              value: `Run \`openmeld center-agent context --cursor ${input.response.continuation.cursor} --organization ${quotePosixShellArgument(input.organizationScope.target.slug)}\``,
            },
          ]
        : []),
    ],
    sanitize: true,
    title: "Center Agent Context",
  });
}

function emitCenterAgentContextReceiptSuccess(input: {
  organizationScope: CenterAgentOrganizationScope;
  presenter: Presenter;
  response: CreateCenterAgentContextLoadReceiptResponse;
  runtime: RuntimeContext;
}): void {
  const payload = {
    organization: input.organizationScope,
    receipt: input.response,
    status: "ok",
  };
  if (input.runtime.resolvedView === "agent") {
    input.presenter.data({
      code: "center_agent.context_receipt",
      payload,
    });
    return;
  }
  renderInfoCard({
    codePrefix: "center-agent.context-receipt.card",
    minContentWidth: 72,
    presenter: input.presenter,
    rows: [
      {
        label: "Organization",
        value: formatOrganizationLabel(input.organizationScope.target),
      },
      { label: "Local Agent", value: input.response.receipt.client },
      {
        label: "Messages Loaded",
        value: String(input.response.receipt.includedMessages),
      },
      {
        label: "Estimated Context Tokens",
        value: String(input.response.receipt.estimatedTokens),
      },
      {
        label: "Recorded",
        value: input.response.recordedAt,
      },
      {
        label: "Meaning",
        value:
          "The Local Agent reported adding these messages to its working context. This does not mean the model used every message in its answer.",
      },
    ],
    sanitize: true,
    title: "Center Agent Context Load Recorded",
  });
}

function buildCenterAgentContextReceiptCommand(input: {
  manifestId: string;
  organizationSlug: string;
  viaOverride?: string;
}): string {
  const viaOverride = String(input.viaOverride ?? "").trim();
  return [
    "openmeld center-agent context receipt",
    quotePosixShellArgument(input.manifestId),
    "--all",
    "--organization",
    quotePosixShellArgument(input.organizationSlug),
    ...(viaOverride ? ["--via", quotePosixShellArgument(viaOverride)] : []),
    "--view agent",
  ].join(" ");
}

function quotePosixShellArgument(value: string): string {
  return POSIX_SHELL_UNQUOTED_ARGUMENT_PATTERN.test(value)
    ? value
    : `'${value.replaceAll("'", `'"'"'`)}'`;
}

function resolveCenterAgentContextLoadSelectionInput(input: {
  all?: boolean;
  entries?: readonly string[];
}): CenterAgentContextLoadSelection | null {
  const entrySpecs = input.entries ?? [];
  if (input.all === true) {
    return entrySpecs.length === 0 ? { kind: "all_manifest_entries" } : null;
  }
  if (entrySpecs.length === 0) {
    return null;
  }
  const entries = entrySpecs.map(parseCenterAgentContextLoadEntrySpec);
  return entries.every((entry) => entry !== null)
    ? {
        entries: entries as Exclude<
          CenterAgentContextLoadSelection,
          { kind: "all_manifest_entries" }
        >["entries"],
        kind: "selected_entries",
      }
    : null;
}

function parseCenterAgentContextLoadEntrySpec(value: string): {
  materializedContentHash: `sha256:${string}`;
  sourceRefId: string;
} | null {
  const separator = "=sha256:";
  const separatorIndex = value.lastIndexOf(separator);
  if (separatorIndex <= 0) {
    return null;
  }
  const sourceRefId = value.slice(0, separatorIndex).trim();
  const materializedContentHash = `sha256:${value
    .slice(separatorIndex + separator.length)
    .trim()}` as `sha256:${string}`;
  return sourceRefId &&
    CENTER_AGENT_CONTEXT_MATERIALIZED_HASH_PATTERN.test(materializedContentHash)
    ? { materializedContentHash, sourceRefId }
    : null;
}
