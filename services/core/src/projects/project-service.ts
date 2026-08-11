import {
  buildCanonicalRepositoryUrl,
  buildRepositoryFingerprint,
  generateProjectSlug,
} from "@openmeld/projects";
import type {
  CreateProjectBody,
  ListProjectsResponse,
  Project,
  UpdateProjectBody,
} from "@openmeld/schemas/types";
import { createCoreRpcHttpError } from "../rpc/errors";
import {
  canArchiveProject,
  canManageProject,
  type ProjectAuthority,
  type ProjectReadAuthority,
  requireProjectArchiveAuthority,
  requireProjectCreateAuthority,
  requireProjectManageAuthority,
} from "./project-authority";
import {
  archiveProjectRecord,
  insertProjectRecord,
  isProjectSlugConflict,
  listActivitySnapshotProjectRecords,
  listProjectRecords,
  readProjectRecord,
  type StoredProject,
  updateProjectRecord,
} from "./project-repository";

export function createProjectService(input: {
  db: D1Database;
  generateId?: () => string;
  now?: () => number;
}) {
  const generateId =
    input.generateId ?? (() => `project_${crypto.randomUUID()}`);
  const now = input.now ?? Date.now;

  return {
    async list(authority: ProjectReadAuthority): Promise<ListProjectsResponse> {
      const projects = await listProjectRecords({
        db: input.db,
        organizationId: authority.organizationId,
      });
      return {
        organizationId: authority.organizationId,
        projects: projects.map((project) => toProject(project, authority)),
      };
    },

    async listForActivitySnapshot(
      authority: ProjectReadAuthority
    ): Promise<ListProjectsResponse> {
      const projects = await listActivitySnapshotProjectRecords({
        db: input.db,
        organizationId: authority.organizationId,
      });
      return {
        organizationId: authority.organizationId,
        projects: projects.map((project) => toProject(project, authority)),
      };
    },

    async read(
      authority: ProjectAuthority,
      projectId: string
    ): Promise<Project> {
      const project = await requireProject({
        authority,
        db: input.db,
        projectId,
      });
      return toProject(project, authority);
    },

    async prepareArchive(
      authority: ProjectAuthority,
      projectId: string
    ): Promise<Project> {
      const project = await requireProject({
        authority,
        db: input.db,
        projectId,
      });
      requireProjectArchiveAuthority({
        authority,
        createdByUserId: project.createdByUserId,
      });
      requireActiveProject(project);
      return toProject(project, authority);
    },

    async create(
      authority: ProjectAuthority,
      body: Omit<CreateProjectBody, "expectedOrganizationId">
    ): Promise<Project> {
      requireProjectCreateAuthority(authority);
      const nowMs = now();
      const repository = await resolveCreatedRepositoryIdentity(body);
      const baseProject = {
        archivedAtMs: null,
        createdAtMs: nowMs,
        createdByUserId: authority.userId,
        hasActivity: false,
        id: generateId(),
        name: body.name,
        organizationId: authority.organizationId,
        ...repository,
        updatedAtMs: nowMs,
      } satisfies Omit<StoredProject, "slug">;

      if (body.slug !== undefined) {
        return await insertProjectWithExplicitSlug({
          authority,
          db: input.db,
          project: { ...baseProject, slug: body.slug },
        });
      }

      for (let sequence = 1; sequence <= 99; sequence += 1) {
        const slug = generateProjectSlug(body.name, sequence);
        if (!slug) {
          break;
        }
        const project: StoredProject = { ...baseProject, slug };
        try {
          const outcome = await insertProjectRecord({ db: input.db, project });
          if (outcome === "limit_reached") {
            throw projectLimitReachedError();
          }
          return toProject(project, authority);
        } catch (error) {
          if (isProjectSlugConflict(error)) {
            continue;
          }
          throw error;
        }
      }
      throw automaticProjectSlugConflictError();
    },

    async update(
      authority: ProjectAuthority,
      projectId: string,
      body: Omit<UpdateProjectBody, "expectedOrganizationId">
    ): Promise<Project> {
      const current = await requireProject({
        authority,
        db: input.db,
        projectId,
      });
      requireProjectManageAuthority({
        authority,
        createdByUserId: current.createdByUserId,
      });
      requireActiveProject(current);
      const repository = await resolveUpdatedRepositoryIdentity({
        body,
        current,
      });
      const updated: StoredProject = {
        ...current,
        name: body.name ?? current.name,
        ...repository,
        slug: body.slug ?? current.slug,
        updatedAtMs: nextMutationTime(now(), current.updatedAtMs),
      };
      try {
        const outcome = await updateProjectRecord({
          currentUpdatedAtMs: current.updatedAtMs,
          db: input.db,
          project: updated,
        });
        if (outcome === "not_updated") {
          throw projectConflictError();
        }
      } catch (error) {
        if (isProjectSlugConflict(error)) {
          throw projectSlugConflictError();
        }
        throw error;
      }
      return toProject(updated, authority);
    },

    async archive(
      authority: ProjectAuthority,
      projectId: string
    ): Promise<Project> {
      const current = await requireProject({
        authority,
        db: input.db,
        projectId,
      });
      const authorityMode = requireProjectArchiveAuthority({
        authority,
        createdByUserId: current.createdByUserId,
      });
      requireActiveProject(current);
      const nowMs = nextMutationTime(now(), current.updatedAtMs);
      const outcome = await archiveProjectRecord({
        authorityMode,
        currentUpdatedAtMs: current.updatedAtMs,
        db: input.db,
        nowMs,
        organizationId: authority.organizationId,
        projectId,
        userId: authority.userId,
      });
      if (outcome === "has_activity") {
        throw projectHasActivityError();
      }
      if (outcome === "not_found") {
        throw projectNotFoundError();
      }
      if (outcome === "conflict") {
        throw projectConflictError();
      }
      return toProject(
        { ...current, archivedAtMs: nowMs, updatedAtMs: nowMs },
        authority
      );
    },
  };
}

export type ProjectService = ReturnType<typeof createProjectService>;

async function insertProjectWithExplicitSlug(input: {
  authority: ProjectAuthority;
  db: D1Database;
  project: StoredProject;
}): Promise<Project> {
  try {
    const outcome = await insertProjectRecord({
      db: input.db,
      project: input.project,
    });
    if (outcome === "limit_reached") {
      throw projectLimitReachedError();
    }
  } catch (error) {
    if (isProjectSlugConflict(error)) {
      throw projectSlugConflictError();
    }
    throw error;
  }
  return toProject(input.project, input.authority);
}

function nextMutationTime(nowMs: number, currentUpdatedAtMs: number): number {
  return Math.max(nowMs, currentUpdatedAtMs + 1);
}

async function requireProject(input: {
  authority: ProjectAuthority;
  db: D1Database;
  projectId: string;
}): Promise<StoredProject> {
  const project = await readProjectRecord({
    db: input.db,
    organizationId: input.authority.organizationId,
    projectId: input.projectId,
  });
  if (!project) {
    throw projectNotFoundError();
  }
  return project;
}

function requireActiveProject(project: StoredProject): void {
  if (project.archivedAtMs === null) {
    return;
  }
  throw createCoreRpcHttpError({
    code: "project.archived",
    reason: "Archived Projects cannot be changed.",
    status: 409,
  });
}

function projectNotFoundError(): Error {
  return createCoreRpcHttpError({
    code: "project.not_found",
    reason: "Project not found.",
    status: 404,
  });
}

function projectSlugConflictError(): Error {
  return createCoreRpcHttpError({
    code: "project.slug_conflict",
    reason: "That CLI slug is already in use in this workspace.",
    status: 409,
  });
}

function automaticProjectSlugConflictError(): Error {
  return createCoreRpcHttpError({
    code: "project.slug_conflict",
    reason:
      "OpenMeld could not find an available CLI slug through the -99 suffix. Choose a different CLI slug.",
    status: 409,
  });
}

function projectLimitReachedError(): Error {
  return createCoreRpcHttpError({
    code: "project.limit_reached",
    reason:
      "This Organization already has the maximum number of active Projects.",
    status: 409,
  });
}

function projectConflictError(): Error {
  return createCoreRpcHttpError({
    code: "project.conflict",
    reason: "Project changed before this request could be applied.",
    status: 409,
  });
}

function projectHasActivityError(): Error {
  return createCoreRpcHttpError({
    code: "project.has_activity",
    reason:
      "This Project already has Activity. Only the organization owner can remove it.",
    status: 409,
  });
}

function toProject(
  project: StoredProject,
  authority: ProjectReadAuthority
): Project {
  const mutationAuthority = toProjectMutationAuthority(authority);
  return {
    archivedAtMs: project.archivedAtMs,
    canArchive:
      project.archivedAtMs === null &&
      mutationAuthority !== null &&
      canArchiveProject({
        authority: mutationAuthority,
        createdByUserId: project.createdByUserId,
        hasActivity: project.hasActivity,
      }),
    canManage:
      project.archivedAtMs === null &&
      mutationAuthority !== null &&
      canManageProject({
        authority: mutationAuthority,
        createdByUserId: project.createdByUserId,
      }),
    createdAtMs: project.createdAtMs,
    createdByUserId: project.createdByUserId,
    id: project.id,
    name: project.name,
    organizationId: project.organizationId,
    repositoryFingerprint: project.repositoryFingerprint,
    ...(project.repositoryUrl ? { repositoryUrl: project.repositoryUrl } : {}),
    slug: project.slug,
    updatedAtMs: project.updatedAtMs,
  };
}

function toProjectMutationAuthority(
  authority: ProjectReadAuthority
): ProjectAuthority | null {
  if (authority.userId === null) {
    return null;
  }
  return { ...authority, userId: authority.userId };
}

async function resolveCreatedRepositoryIdentity(
  body: Pick<CreateProjectBody, "repositoryFingerprint" | "repositoryUrl">
): Promise<Pick<StoredProject, "repositoryFingerprint" | "repositoryUrl">> {
  if (body.repositoryUrl === undefined) {
    return {
      repositoryFingerprint: body.repositoryFingerprint ?? null,
      repositoryUrl: null,
    };
  }
  return await resolveCanonicalRepositoryIdentity({
    repositoryFingerprint: body.repositoryFingerprint,
    repositoryUrl: body.repositoryUrl,
  });
}

async function resolveUpdatedRepositoryIdentity(input: {
  body: Pick<UpdateProjectBody, "repositoryFingerprint" | "repositoryUrl">;
  current: StoredProject;
}): Promise<Pick<StoredProject, "repositoryFingerprint" | "repositoryUrl">> {
  if (input.body.repositoryUrl === null) {
    if (input.body.repositoryFingerprint) {
      throw projectRepositoryIdentityInvalidError();
    }
    return { repositoryFingerprint: null, repositoryUrl: null };
  }
  if (input.body.repositoryUrl !== undefined) {
    return await resolveCanonicalRepositoryIdentity({
      repositoryFingerprint: input.body.repositoryFingerprint ?? undefined,
      repositoryUrl: input.body.repositoryUrl,
    });
  }
  if (input.body.repositoryFingerprint !== undefined) {
    return {
      repositoryFingerprint: input.body.repositoryFingerprint,
      repositoryUrl:
        input.body.repositoryFingerprint === input.current.repositoryFingerprint
          ? input.current.repositoryUrl
          : null,
    };
  }
  return {
    repositoryFingerprint: input.current.repositoryFingerprint,
    repositoryUrl: input.current.repositoryUrl,
  };
}

async function resolveCanonicalRepositoryIdentity(input: {
  repositoryFingerprint?: string | null;
  repositoryUrl: string;
}): Promise<Pick<StoredProject, "repositoryFingerprint" | "repositoryUrl">> {
  const repositoryUrl = buildCanonicalRepositoryUrl(input.repositoryUrl);
  const repositoryFingerprint = repositoryUrl
    ? await buildRepositoryFingerprint(repositoryUrl)
    : null;
  if (
    !(repositoryUrl && repositoryFingerprint) ||
    (input.repositoryFingerprint !== undefined &&
      input.repositoryFingerprint !== repositoryFingerprint)
  ) {
    throw projectRepositoryIdentityInvalidError();
  }
  return { repositoryFingerprint, repositoryUrl };
}

function projectRepositoryIdentityInvalidError(): Error {
  return createCoreRpcHttpError({
    code: "project.repository_identity_invalid",
    reason: "Repository URL and repository identity do not match.",
    status: 400,
  });
}
