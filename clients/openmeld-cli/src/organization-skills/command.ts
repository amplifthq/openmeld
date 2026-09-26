import { createHash } from "node:crypto";
import {
  createOrganizationSkillsApi,
  type OrganizationSkillsApi,
} from "@openmeld/api-client";
import {
  cliJsonSkillsAddAllEnvelopeSchema,
  cliJsonSkillsAddEnvelopeSchema,
  cliJsonSkillsAddPreviewEnvelopeSchema,
  cliJsonSkillsListEnvelopeSchema,
  cliJsonSkillsLoadEnvelopeSchema,
  cliJsonSkillsScanEnvelopeSchema,
  cliJsonSkillsShowEnvelopeSchema,
} from "@openmeld/schemas";
import type {
  OpenMeldRequestContext,
  OrganizationSkill,
  OrganizationSkillGitHubRepositoryPreview,
  OrganizationSkillSource,
  OrganizationSkillSummary,
} from "@openmeld/schemas/types";
import {
  getAuthSessionState,
  type StoredActiveOrganization,
} from "../config/auth-session";
import { resolveBaseUrl } from "../config/base-url";
import { resolveOpenMeldProfile } from "../config/openmeld-profiles-api";
import { buildOpenMeldRequestContextFromProfile } from "../config/openmeld-request-context";
import { emitCliJsonEnvelope } from "../runtime/cli-json-output";
import { resolveRuntimeContext } from "../runtime/context";
import { createPresenter } from "../runtime/presenter";
import type { Presenter } from "../runtime/presenter/types";
import { createCliApiClientFoundation } from "../space/api-client-foundation";
import { renderInfoCard } from "../ui/info-card";
import { sanitizeTerminalDisplayText } from "../ui/terminal-safe-text";
import {
  type MaterializedOrganizationSkillRelease,
  materializeOrganizationSkillRelease,
} from "./cache";
import { readLocalSkillFiles } from "./local-source";

type OrganizationSkillsCommandInput = {
  json?: boolean;
  view?: string;
};

type OrganizationSkillsCommandContext = {
  api: OrganizationSkillsApi;
  json: boolean;
  organization: StoredActiveOrganization;
  presenter: Presenter;
  requestContext: OpenMeldRequestContext;
};

export type OrganizationSkillsCommandDependencies = {
  getAuthState: typeof getAuthSessionState;
  materialize: typeof materializeOrganizationSkillRelease;
  resolveApi: () => Promise<OrganizationSkillsApi>;
  resolveHumanProfile: typeof resolveOpenMeldProfile;
};

const defaultDependencies: OrganizationSkillsCommandDependencies = {
  getAuthState: getAuthSessionState,
  materialize: materializeOrganizationSkillRelease,
  resolveApi: async () =>
    createOrganizationSkillsApi(
      createCliApiClientFoundation(await resolveBaseUrl())
    ),
  resolveHumanProfile: resolveOpenMeldProfile,
};
const GITHUB_COMMIT_SHA_PATTERN = /^[a-f0-9]{40}$/;
const ORGANIZATION_SKILL_IMPORT_TIMEOUT_MS = 60_000;

export async function runOrganizationSkillsList(
  input: OrganizationSkillsCommandInput = {},
  dependencyOverrides: Partial<OrganizationSkillsCommandDependencies> = {}
): Promise<void> {
  await runOrganizationSkillsCommand(
    input,
    dependencyOverrides,
    async (context) => {
      const response = await listForCurrentOrganization(context);
      if (context.json) {
        emitCliJsonEnvelope(
          cliJsonSkillsListEnvelopeSchema.parse({
            schemaVersion: 1,
            type: "skills.list",
            ...response,
          })
        );
        return;
      }
      if (context.presenter.view === "agent") {
        context.presenter.data({
          code: "skills.list",
          payload: response,
        });
        return;
      }
      renderSkillsList(context, response.skills);
    }
  );
}

export async function runOrganizationSkillsAdd(
  input: OrganizationSkillsCommandInput & {
    source: string;
    previewOnly?: boolean;
    operationId?: string;
  },
  dependencyOverrides: Partial<OrganizationSkillsCommandDependencies> = {}
): Promise<void> {
  await runOrganizationSkillsCommand(
    input,
    dependencyOverrides,
    async (context) => {
      if (!input.source.startsWith("https://github.com/")) {
        if (input.source.includes("://")) {
          throw new Error(
            "Choose a local Skill directory or a github.com URL."
          );
        }
        const files = await readLocalSkillFiles(input.source);
        const preview = await context.api.previewFromFiles({
          expectedOrganizationId: context.organization.id,
          files,
          requestContext: context.requestContext,
        });
        requireOrganizationIdentity(context, preview.organizationId);
        const summary = {
          name: preview.preview.portable.name,
          files: preview.preview.files.map(({ path, size }) => ({
            path,
            size,
          })),
          warnings: preview.preview.warnings,
        };
        if (input.previewOnly) {
          emitOrganizationSkillAddResult(
            context,
            "skills.add.preview",
            summary
          );
          return;
        }
        const installed = await context.api.importFromFiles({
          expectedOrganizationId: context.organization.id,
          files,
          requestContext: context.requestContext,
        });
        requireOrganizationIdentity(context, installed.skill.organizationId);
        if (installed.skill.name !== preview.preview.portable.name) {
          throw new Error("The installed Skill does not match its preview.");
        }
        emitOrganizationSkillAddResult(context, "skills.add", {
          ...summary,
          skillId: installed.skill.id,
          releaseId: installed.skill.activeRelease.id,
        });
        return;
      }
      const preview = await context.api.previewFromGitHub({
        expectedOrganizationId: context.organization.id,
        requestContext: context.requestContext,
        url: input.source,
      });
      requireOrganizationIdentity(context, preview.organizationId);
      const summary = {
        name: preview.preview.portable.name,
        commitSha: preview.preview.source.commitSha,
        files: preview.preview.files,
        warnings: preview.preview.warnings,
      };
      if (input.previewOnly) {
        emitOrganizationSkillAddResult(context, "skills.add.preview", summary);
        return;
      }
      const installed = await context.api.importFromGitHub({
        expectedCommitSha: preview.preview.source.commitSha,
        expectedOrganizationId: context.organization.id,
        operationId: input.operationId ?? crypto.randomUUID(),
        requestContext: context.requestContext,
        timeoutMs: ORGANIZATION_SKILL_IMPORT_TIMEOUT_MS,
        url: input.source,
      });
      requireOrganizationIdentity(context, installed.skill.organizationId);
      if (installed.skill.name !== preview.preview.portable.name) {
        throw new Error("The installed Skill does not match its preview.");
      }
      emitOrganizationSkillAddResult(context, "skills.add", {
        ...summary,
        skillId: installed.skill.id,
        releaseId: installed.skill.activeRelease.id,
      });
    }
  );
}

export async function runOrganizationSkillsAddAll(
  input: OrganizationSkillsCommandInput & {
    source: string;
    operationId?: string;
  },
  dependencyOverrides: Partial<OrganizationSkillsCommandDependencies> = {}
): Promise<void> {
  const source = parseRepositoryBatchSource(input.source);
  if (input.operationId && !source.pinnedCommitSha) {
    throw new Error(
      "Retry a repository batch with its pinned commit URL and --operation-id."
    );
  }
  await runOrganizationSkillsCommand(
    input,
    dependencyOverrides,
    async (context) => {
      const response = await context.api.previewRepositoryFromGitHub({
        expectedOrganizationId: context.organization.id,
        requestContext: context.requestContext,
        url: source.url,
      });
      requireOrganizationIdentity(context, response.organizationId);
      if (
        source.pinnedCommitSha &&
        source.pinnedCommitSha !== response.preview.commitSha
      ) {
        throw new Error(
          "The repository preview did not match the pinned commit."
        );
      }
      const existingSkills = await listForCurrentOrganization(context);
      const existingPaths = new Set(
        existingSkills.skills.flatMap((skill) =>
          skill.source.kind === "github" &&
          skill.source.repository === response.preview.repository
            ? [skill.source.path]
            : []
        )
      );
      const batchId = input.operationId ?? crypto.randomUUID();
      const results: RepositoryInstallResult[] = [];
      if (!context.json && context.presenter.view !== "agent") {
        context.presenter.line({
          code: "skills.add.all.start",
          text: `Installing Skills from commit ${response.preview.commitSha.slice(0, 12)}. Retry ID: ${batchId}.`,
        });
      }
      for (const item of response.preview.skills) {
        const result = await installRepositorySkill(
          context,
          item,
          response.preview.commitSha,
          batchId,
          existingPaths
        );
        results.push(result);
        if (!context.json && context.presenter.view !== "agent") {
          context.presenter.line({
            code: "skills.add.all.item",
            text: `${sanitizeTerminalDisplayText(result.path || "Repository root")} — ${result.status}${result.error ? `: ${sanitizeTerminalDisplayText(result.error)}` : ""}`,
          });
        }
      }
      const payload = {
        commitSha: response.preview.commitSha,
        operationId: batchId,
        organizationId: context.organization.id,
        repository: response.preview.repository,
        retrySource: `${response.preview.repository}/tree/${response.preview.commitSha}`,
        results,
      };
      presentRepositoryInstallSummary(context, payload);
    }
  );
}

function presentRepositoryInstallSummary(
  context: OrganizationSkillsCommandContext,
  payload: {
    commitSha: string;
    operationId: string;
    organizationId: string;
    repository: string;
    retrySource: string;
    results: RepositoryInstallResult[];
  }
): void {
  if (context.json) {
    emitCliJsonEnvelope(
      cliJsonSkillsAddAllEnvelopeSchema.parse({
        schemaVersion: 1,
        type: "skills.add.all",
        ...payload,
      })
    );
    return;
  }
  if (context.presenter.view === "agent") {
    context.presenter.data({ code: "skills.add.all", payload });
    return;
  }
  const installedCount = payload.results.filter(
    (item) => item.status === "installed"
  ).length;
  context.presenter.line({
    code: "skills.add.all.summary",
    text: `${installedCount} of ${payload.results.length} Skills installed from commit ${payload.commitSha.slice(0, 12)}. Retry with: openmeld skills add ${payload.retrySource} --all --operation-id ${payload.operationId}`,
  });
}

function parseRepositoryBatchSource(source: string): {
  pinnedCommitSha: string | null;
  url: string;
} {
  let parsed: URL;
  try {
    parsed = new URL(source);
  } catch {
    throw new Error("Choose a public github.com repository for --all.");
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") {
    throw new Error("Choose a public github.com repository for --all.");
  }
  const parts = parsed.pathname.split("/").filter(Boolean);
  const pinnedCommitSha =
    parts.length === 4 &&
    parts[2] === "tree" &&
    GITHUB_COMMIT_SHA_PATTERN.test(parts[3] ?? "")
      ? (parts[3] ?? null)
      : null;
  if (parts.length !== 2 && !pinnedCommitSha) {
    throw new Error(
      "Use a GitHub repository URL or its pinned commit URL for --all."
    );
  }
  return { pinnedCommitSha, url: source };
}

type RepositoryInstallItem =
  OrganizationSkillGitHubRepositoryPreview["skills"][number];
type RepositoryInstallResult = {
  error?: string;
  path: string;
  releaseId?: string;
  skillId?: string;
  status: "installed" | "skipped" | "failed";
  url: string;
};

async function installRepositorySkill(
  context: OrganizationSkillsCommandContext,
  item: RepositoryInstallItem,
  commitSha: string,
  batchId: string,
  existingPaths: Set<string>
): Promise<RepositoryInstallResult> {
  if (existingPaths.has(item.path)) {
    return {
      error: "Already in Team",
      path: item.path,
      status: "skipped",
      url: item.url,
    };
  }
  if (item.blocker) {
    return {
      error: item.blocker.message,
      path: item.path,
      status: "skipped",
      url: item.url,
    };
  }
  const operationId = createHash("sha256")
    .update(`${batchId}\n${item.path}`)
    .digest("hex");
  try {
    const installed = await context.api.importFromGitHub({
      expectedCommitSha: commitSha,
      expectedOrganizationId: context.organization.id,
      operationId,
      requestContext: context.requestContext,
      timeoutMs: ORGANIZATION_SKILL_IMPORT_TIMEOUT_MS,
      url: item.url,
    });
    requireOrganizationIdentity(context, installed.skill.organizationId);
    return {
      path: item.path,
      releaseId: installed.skill.activeRelease.id,
      skillId: installed.skill.id,
      status: "installed",
      url: item.url,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      path: item.path,
      status: "failed",
      url: item.url,
    };
  }
}

export async function runOrganizationSkillsScan(
  input: OrganizationSkillsCommandInput & { url: string },
  dependencyOverrides: Partial<OrganizationSkillsCommandDependencies> = {}
): Promise<void> {
  await runOrganizationSkillsCommand(
    input,
    dependencyOverrides,
    async (context) => {
      const response = await context.api.previewRepositoryFromGitHub({
        expectedOrganizationId: context.organization.id,
        requestContext: context.requestContext,
        url: input.url,
      });
      requireOrganizationIdentity(context, response.organizationId);
      const payload = {
        organizationId: response.organizationId,
        preview: response.preview,
      };
      if (context.json) {
        emitCliJsonEnvelope(
          cliJsonSkillsScanEnvelopeSchema.parse({
            schemaVersion: 1,
            type: "skills.scan",
            ...payload,
          })
        );
        return;
      }
      if (context.presenter.view === "agent") {
        context.presenter.data({ code: "skills.scan", payload });
        return;
      }
      context.presenter.line({
        code: "skills.scan.summary",
        text: `${response.preview.skills.length} Skills found at commit ${response.preview.commitSha.slice(0, 12)}.`,
      });
      for (const item of response.preview.skills) {
        const path = sanitizeTerminalDisplayText(
          item.path || "Repository root"
        );
        const status = item.blocker
          ? `Can't install: ${sanitizeTerminalDisplayText(item.blocker.message)}`
          : `${item.fileCount} ${item.fileCount === 1 ? "file" : "files"} · ${item.totalBytes.toLocaleString()} bytes`;
        context.presenter.line({
          code: "skills.scan.item",
          text: `${path} — ${status}`,
        });
      }
    }
  );
}

function emitOrganizationSkillAddResult(
  context: OrganizationSkillsCommandContext,
  code: "skills.add" | "skills.add.preview",
  result: {
    name: string;
    commitSha?: string;
    files: readonly { path: string; size: number }[];
    warnings: readonly string[];
    skillId?: string;
    releaseId?: string;
  }
): void {
  const payload = {
    organizationId: context.organization.id,
    ...result,
  };
  if (context.json) {
    if (code === "skills.add.preview") {
      emitCliJsonEnvelope(
        cliJsonSkillsAddPreviewEnvelopeSchema.parse({
          schemaVersion: 1,
          type: code,
          ...payload,
        })
      );
    } else {
      emitCliJsonEnvelope(
        cliJsonSkillsAddEnvelopeSchema.parse({
          schemaVersion: 1,
          type: code,
          ...payload,
        })
      );
    }
    return;
  }
  if (context.presenter.view === "agent") {
    context.presenter.data({ code, payload });
    return;
  }
  context.presenter.line({
    code,
    text: `${code === "skills.add.preview" ? "Preview" : "Added"} ${result.name} (${result.files.length} supporting files)${result.commitSha ? ` from commit ${result.commitSha.slice(0, 12)}` : ""}.`,
  });
  for (const warning of result.warnings) {
    context.presenter.line({ code: "skills.add.warning", text: warning });
  }
}

export async function runOrganizationSkillsShow(
  input: OrganizationSkillsCommandInput & { skill: string },
  dependencyOverrides: Partial<OrganizationSkillsCommandDependencies> = {}
): Promise<void> {
  await runOrganizationSkillsCommand(
    input,
    dependencyOverrides,
    async (context) => {
      const skill = await getSkillByNameOrId(context, input.skill);
      const response = { skill };
      if (context.json) {
        emitCliJsonEnvelope(
          cliJsonSkillsShowEnvelopeSchema.parse({
            schemaVersion: 1,
            type: "skills.show",
            ...response,
          })
        );
        return;
      }
      if (context.presenter.view === "agent") {
        context.presenter.data({
          code: "skills.show",
          payload: response,
        });
        return;
      }
      renderSkill(context, skill);
    }
  );
}

export async function runOrganizationSkillsLoad(
  input: OrganizationSkillsCommandInput & { skill: string; releaseId?: string },
  dependencyOverrides: Partial<OrganizationSkillsCommandDependencies> = {}
): Promise<void> {
  await runOrganizationSkillsCommand(
    input,
    dependencyOverrides,
    async (context, dependencies) => {
      const skill = await getSkillByNameOrId(context, input.skill);
      if (!skill.enabled) {
        throw new Error(
          `Organization Skill "${skill.name}" is disabled. Ask an Organization owner or admin to enable it before loading.`
        );
      }
      const selected =
        input.releaseId === undefined
          ? {
              bundle: skill.bundle,
              digest: skill.activeRelease.digest,
              releaseId: skill.activeRelease.id,
              skillId: skill.id,
            }
          : await readSelectedRelease(context, skill.id, input.releaseId);
      if (
        !selected ||
        selected.skillId !== skill.id ||
        (input.releaseId !== undefined &&
          selected.releaseId !== input.releaseId)
      ) {
        throw new Error(
          "The requested Skill release was not returned. Update the server before loading an exact release."
        );
      }
      const materialized = await dependencies.materialize({
        bundle: selected.bundle,
        digest: selected.digest,
        organizationId: context.organization.id,
        releaseId: selected.releaseId,
        skillId: skill.id,
      });
      const payload = buildLoadPayload(context, skill, materialized, selected);
      if (context.json) {
        emitCliJsonEnvelope(
          cliJsonSkillsLoadEnvelopeSchema.parse({
            schemaVersion: 1,
            type: "skills.load",
            ...payload,
          })
        );
        return;
      }
      if (context.presenter.view === "agent") {
        context.presenter.data({
          code: "skills.load",
          payload,
        });
        return;
      }
      renderLoadedSkill(context, payload);
    }
  );
}

async function readSelectedRelease(
  context: OrganizationSkillsCommandContext,
  skillId: string,
  releaseId: string
) {
  const response = await context.api.get({
    requestContext: context.requestContext,
    skillId,
    releaseId,
  });
  requireOrganizationIdentity(context, response.skill.organizationId);
  if (!response.skill.enabled) {
    throw new Error("This Organization Skill is disabled.");
  }
  return response.selectedRelease;
}

async function runOrganizationSkillsCommand(
  input: OrganizationSkillsCommandInput,
  dependencyOverrides: Partial<OrganizationSkillsCommandDependencies>,
  run: (
    context: OrganizationSkillsCommandContext,
    dependencies: OrganizationSkillsCommandDependencies
  ) => Promise<void>
): Promise<void> {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };
  const runtime = await resolveRuntimeContext({ view: input.view });
  const presenter = createPresenter(runtime);
  const auth = await dependencies.getAuthState({ validateRemote: true });
  const organization = auth.session?.activeOrganization;
  if (auth.state !== "valid" || !organization) {
    throw new Error(
      "Sign in and choose an active Organization before reading Organization Skills. Run `openmeld login`, then `openmeld org switch <slug>`."
    );
  }
  const humanProfile = await dependencies.resolveHumanProfile({
    profileKind: "human",
  });
  await run(
    {
      api: await dependencies.resolveApi(),
      json: input.json === true,
      organization,
      presenter,
      requestContext: buildOpenMeldRequestContextFromProfile({
        openMeldProfile: humanProfile,
      }),
    },
    dependencies
  );
}

async function listForCurrentOrganization(
  context: OrganizationSkillsCommandContext
) {
  const response = await context.api.list({
    requestContext: context.requestContext,
  });
  requireOrganizationIdentity(context, response.organizationId);
  return response;
}

async function getSkillByNameOrId(
  context: OrganizationSkillsCommandContext,
  value: string
): Promise<OrganizationSkill> {
  const skillReference = value.trim();
  if (!skillReference) {
    throw new Error("Organization Skill name or id is required.");
  }
  const listed = await listForCurrentOrganization(context);
  const summary = listed.skills.find(
    (candidate) =>
      candidate.id === skillReference || candidate.name === skillReference
  );
  if (!summary) {
    throw new Error(
      `Organization Skill "${skillReference}" was not found in ${context.organization.name}. Run \`openmeld skills list\` to see available Skills.`
    );
  }
  const response = await context.api.get({
    requestContext: context.requestContext,
    skillId: summary.id,
  });
  requireOrganizationIdentity(context, response.skill.organizationId);
  if (response.skill.id !== summary.id) {
    throw new Error(
      "The Organization Skill identity changed while the command was running."
    );
  }
  return response.skill;
}

function requireOrganizationIdentity(
  context: OrganizationSkillsCommandContext,
  responseOrganizationId: string
): void {
  if (context.organization.id === responseOrganizationId) {
    return;
  }
  throw new Error(
    `The active Organization changed while this command was running. Run \`openmeld org switch ${context.organization.slug}\`, then retry.`
  );
}

function renderSkillsList(
  context: OrganizationSkillsCommandContext,
  skills: OrganizationSkillSummary[]
): void {
  renderInfoCard({
    codePrefix: "skills.list.summary",
    presenter: context.presenter,
    rows: [
      { label: "Organization", value: context.organization.name },
      { label: "Skills", value: String(skills.length) },
    ],
    sanitize: true,
    title: "Organization Skills",
  });
  if (skills.length === 0) {
    context.presenter.line({
      code: "skills.list.empty",
      text: "No Organization Skills are installed.",
    });
    return;
  }
  for (const skill of skills) {
    renderInfoCard({
      codePrefix: "skills.list.skill",
      compact: true,
      presenter: context.presenter,
      rows: [
        { label: "Status", value: skill.enabled ? "Enabled" : "Disabled" },
        { label: "Description", value: skill.description },
        { label: "ID", value: skill.id },
        {
          label: "Release",
          value: `${skill.activeRelease.id} · ${shortDigest(
            skill.activeRelease.digest
          )}`,
        },
        {
          label: "Next",
          value: `openmeld skills show ${skill.name}`,
        },
      ],
      sanitize: true,
      title: skill.name,
    });
  }
}

function renderSkill(
  context: OrganizationSkillsCommandContext,
  skill: OrganizationSkill
): void {
  renderInfoCard({
    codePrefix: "skills.show.summary",
    presenter: context.presenter,
    rows: [
      { label: "Organization", value: context.organization.name },
      { label: "Name", value: skill.name },
      { label: "Status", value: skill.enabled ? "Enabled" : "Disabled" },
      { label: "ID", value: skill.id },
      { label: "Description", value: skill.description },
      { label: "Source", value: formatSource(skill.source) },
      {
        label: "Active release",
        value: `${skill.activeRelease.id} · ${skill.activeRelease.digest}`,
      },
      {
        label: "Compatibility",
        value: skill.bundle.portable.compatibility ?? "Not specified",
      },
      {
        label: "Allowed tools",
        value: skill.bundle.portable.allowedTools
          ? `${skill.bundle.portable.allowedTools} (metadata only; does not grant permission)`
          : "Not specified",
      },
      {
        label: "Maintainers",
        value:
          skill.maintainerUserIds.length === 0
            ? "None"
            : skill.maintainerUserIds.join(", "),
      },
      { label: "Files", value: String(skill.bundle.files.length) },
      { label: "Releases", value: String(skill.releases.length) },
    ],
    sanitize: true,
    title: "Organization Skill",
  });
  context.presenter.line({
    code: "skills.show.instructions.heading",
    text: "\nInstructions\n",
  });
  context.presenter.line({
    code: "skills.show.instructions",
    text:
      sanitizeTerminalDisplayText(skill.bundle.instructions, "multi-line") ||
      "(No instructions)",
  });
  if (skill.bundle.files.length > 0) {
    context.presenter.line({
      code: "skills.show.resources.heading",
      text: "\nResources",
    });
    for (const file of skill.bundle.files) {
      context.presenter.line({
        code: "skills.show.resource",
        text: `- ${sanitizeTerminalDisplayText(file.path)} · ${file.size} bytes · ${file.mediaType}${
          file.path.startsWith("scripts/") ? " · Not executable" : ""
        }`,
      });
    }
  }
}

function buildLoadPayload(
  context: OrganizationSkillsCommandContext,
  skill: OrganizationSkill,
  materialized: MaterializedOrganizationSkillRelease,
  selected: { digest: string; releaseId: string }
) {
  return {
    cachePath: materialized.cachePath,
    digest: selected.digest,
    organizationId: context.organization.id,
    releaseId: selected.releaseId,
    resourcePaths: materialized.resourcePaths,
    reused: materialized.reused,
    skillId: skill.id,
    skillMarkdownPath: materialized.skillMarkdownPath,
    skillName: skill.name,
  };
}

function renderLoadedSkill(
  context: OrganizationSkillsCommandContext,
  payload: ReturnType<typeof buildLoadPayload>
): void {
  renderInfoCard({
    codePrefix: "skills.load",
    presenter: context.presenter,
    rows: [
      { label: "Organization", value: context.organization.name },
      { label: "Skill", value: payload.skillName },
      { label: "Release", value: payload.releaseId },
      { label: "Digest", value: payload.digest },
      { label: "SKILL.md", value: payload.skillMarkdownPath },
      {
        label: "Cache",
        value: payload.reused ? "Verified existing cache" : "Downloaded",
      },
      {
        label: "Note",
        value:
          "This private cache is read-only. Script files are present without executable permission.",
      },
    ],
    sanitize: true,
    title: "Organization Skill Loaded",
  });
}

function formatSource(source: OrganizationSkillSource): string {
  if (source.kind === "created") {
    return "Created in OpenMeld";
  }
  return `${source.repository} · ${source.commitSha.slice(0, 12)} · ${
    source.path || "/"
  }`;
}

function shortDigest(digest: string): string {
  return `${digest.slice(0, 12)}…`;
}
