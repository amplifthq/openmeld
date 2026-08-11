import {
  createOrganizationSkillsApi,
  type OrganizationSkillsApi,
} from "@openmeld/api-client";
import {
  cliJsonSkillsListEnvelopeSchema,
  cliJsonSkillsLoadEnvelopeSchema,
  cliJsonSkillsShowEnvelopeSchema,
} from "@openmeld/schemas";
import type {
  OpenMeldRequestContext,
  OrganizationSkill,
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
  input: OrganizationSkillsCommandInput & { skill: string },
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
      const materialized = await dependencies.materialize({
        bundle: skill.bundle,
        digest: skill.activeRelease.digest,
        organizationId: context.organization.id,
        releaseId: skill.activeRelease.id,
        skillId: skill.id,
      });
      const payload = buildLoadPayload(context, skill, materialized);
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
  materialized: MaterializedOrganizationSkillRelease
) {
  return {
    cachePath: materialized.cachePath,
    digest: skill.activeRelease.digest,
    organizationId: context.organization.id,
    releaseId: skill.activeRelease.id,
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
