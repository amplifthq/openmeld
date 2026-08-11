import {
  ORGANIZATION_SKILL_RUNTIME_CATALOG_MAX_BYTES,
  ORGANIZATION_SKILL_RUNTIME_RELEASE_LIMIT,
  organizationSkillBundleSchema,
  organizationSkillRuntimeReleaseSelectionSchema,
  organizationSkillRuntimeSnapshotResponseSchema,
  organizationSkillSchema,
  organizationSkillSourceSchema,
  organizationSkillSummarySchema,
  stringifyOrganizationSkillBundleCanonicalJson,
} from "@openmeld/schemas";
import type {
  OrganizationSkill,
  OrganizationSkillBundle,
  OrganizationSkillGitHubPreview,
  OrganizationSkillRuntimeReleaseSelection,
  OrganizationSkillRuntimeSnapshotResponse,
  OrganizationSkillSource,
  OrganizationSkillSummary,
} from "@openmeld/schemas/types";
import { createCoreRpcHttpError } from "../rpc/errors";
import { importOrganizationSkillBundleFromGitHub } from "./github-skill-import";

export type OrganizationSkillActor = {
  organizationId: string;
  role: string;
  userId: string;
};

export type OrganizationSkillReadActor = Omit<
  OrganizationSkillActor,
  "userId"
> & {
  userId: string | null;
};

type OrganizationSkillServiceDependencies = {
  bucket: R2Bucket;
  db: D1Database;
  fetch?: typeof fetch;
  githubToken?: string;
  newId?: () => string;
  now?: () => number;
};

type SkillRow = {
  active_release_id: string;
  created_at: number;
  created_by_user_id: string;
  description: string;
  enabled: number;
  id: string;
  maintainer_update_token: string | null;
  name: string;
  organization_id: string;
  removed_at: number | null;
  source_commit_sha: string | null;
  source_kind: "created" | "github";
  source_path: string | null;
  source_repository: string | null;
  updated_at: number;
  version: number;
};

type ReleaseRow = {
  created_at: number;
  created_by_user_id: string;
  digest: string;
  id: string;
  manifest_json: string;
  object_key: string;
  organization_id: string;
  skill_id: string;
  source_commit_sha: string | null;
  source_kind: "created" | "github";
  source_path: string | null;
  source_repository: string | null;
};

type RuntimeCatalogUsage = {
  enabled_releases: number;
  runtime_bytes: number;
};

export async function readEnabledOrganizationSkillReleaseSelection(input: {
  db: D1Database;
  organizationId: string;
}): Promise<OrganizationSkillRuntimeReleaseSelection[]> {
  const rows = await input.db
    .prepare(
      `
        SELECT s.id AS skill_id,
               s.name,
               r.id AS release_id,
               r.digest,
               r.manifest_json
        FROM organization_skills s
        JOIN organization_skill_releases r
          ON r.id = s.active_release_id
         AND r.skill_id = s.id
         AND r.organization_id = s.organization_id
        WHERE s.organization_id = ?
          AND s.enabled = 1
          AND s.removed_at IS NULL
        ORDER BY s.name ASC, s.id ASC
        LIMIT ?
      `
    )
    .bind(input.organizationId, ORGANIZATION_SKILL_RUNTIME_RELEASE_LIMIT + 1)
    .all<{
      digest: string;
      manifest_json: string;
      name: string;
      release_id: string;
      skill_id: string;
    }>();
  if (rows.results.length > ORGANIZATION_SKILL_RUNTIME_RELEASE_LIMIT) {
    throw runtimeReleaseLimitError();
  }
  const runtimeBytes = rows.results.reduce(
    (total, row) => total + readManifestRuntimeBytes(row.manifest_json),
    0
  );
  if (runtimeBytes > ORGANIZATION_SKILL_RUNTIME_CATALOG_MAX_BYTES) {
    throw runtimeCatalogTooLargeError();
  }
  return rows.results.map((row) =>
    organizationSkillRuntimeReleaseSelectionSchema.parse({
      digest: row.digest,
      name: row.name,
      releaseId: row.release_id,
      skillId: row.skill_id,
    })
  );
}

export function createOrganizationSkillService(
  dependencies: OrganizationSkillServiceDependencies
) {
  const now = dependencies.now ?? Date.now;
  const newId = dependencies.newId ?? (() => crypto.randomUUID());

  return {
    async create(
      actor: OrganizationSkillActor,
      input: {
        description: string;
        instructions: string;
        name: string;
      }
    ): Promise<OrganizationSkill> {
      requireManager(actor);
      const bundle = parseBundle({
        files: [],
        instructions: input.instructions,
        portable: {
          allowedTools: null,
          compatibility: null,
          description: input.description,
          license: null,
          metadata: {},
          name: input.name,
        },
      });
      return await createSkill({
        actor,
        bundle,
        dependencies,
        newId,
        now,
        source: { kind: "created" },
      });
    },

    async get(
      actor: OrganizationSkillReadActor,
      skillId: string
    ): Promise<OrganizationSkill> {
      const skill = await requireSkill(
        dependencies.db,
        actor.organizationId,
        skillId
      );
      return await buildSkill({
        actor,
        bucket: dependencies.bucket,
        db: dependencies.db,
        skill,
      });
    },

    async installBundle(
      actor: OrganizationSkillActor,
      input: {
        bundle: OrganizationSkillBundle;
        source: OrganizationSkillSource;
      }
    ): Promise<OrganizationSkill> {
      requireManager(actor);
      return await createSkill({
        actor,
        bundle: parseBundle(input.bundle),
        dependencies,
        newId,
        now,
        source: organizationSkillSourceSchema.parse(input.source),
      });
    },

    async importFromGitHub(
      actor: OrganizationSkillActor,
      url: string,
      expectedCommitSha?: string
    ): Promise<OrganizationSkill> {
      requireManager(actor);
      const imported = await importOrganizationSkillBundleFromGitHub({
        expectedCommitSha,
        fetch: dependencies.fetch,
        githubToken: dependencies.githubToken,
        url,
      });
      return await createSkill({
        actor,
        bundle: imported.bundle,
        dependencies,
        newId,
        now,
        source: imported.source,
      });
    },

    async previewFromGitHub(
      actor: OrganizationSkillActor,
      url: string
    ): Promise<OrganizationSkillGitHubPreview> {
      requireManager(actor);
      const imported = await importOrganizationSkillBundleFromGitHub({
        fetch: dependencies.fetch,
        githubToken: dependencies.githubToken,
        url,
      });
      const warnings: string[] = [];
      if (
        imported.bundle.files.some((file) => file.path.startsWith("scripts/"))
      ) {
        warnings.push(
          "Scripts are stored for portability but are not executable in OpenMeld Phase 1."
        );
      }
      if (imported.bundle.portable.allowedTools !== null) {
        warnings.push(
          "The allowed-tools field is preserved but does not grant OpenMeld permissions."
        );
      }
      return {
        files: imported.bundle.files.map((file) => ({
          encoding: file.encoding,
          mediaType: file.mediaType,
          path: file.path,
          size: file.size,
        })),
        instructionsCharacters: imported.bundle.instructions.length,
        portable: imported.bundle.portable,
        source: imported.source,
        warnings,
      };
    },

    async list(
      actor: OrganizationSkillReadActor
    ): Promise<OrganizationSkillSummary[]> {
      const rows = await dependencies.db
        .prepare(
          `
            SELECT s.*,
                   r.id AS release_id,
                   r.digest AS release_digest,
                   r.created_at AS release_created_at,
                   r.created_by_user_id AS release_created_by_user_id,
                   r.source_kind AS release_source_kind,
                   r.source_repository AS release_source_repository,
                   r.source_path AS release_source_path,
                   r.source_commit_sha AS release_source_commit_sha,
                   CASE WHEN m.user_id IS NULL THEN 0 ELSE 1 END AS is_maintainer
            FROM organization_skills s
            JOIN organization_skill_releases r
              ON r.id = s.active_release_id
             AND r.skill_id = s.id
             AND r.organization_id = s.organization_id
            LEFT JOIN organization_skill_maintainers m
              ON m.skill_id = s.id
             AND m.organization_id = s.organization_id
             AND m.user_id = ?
            WHERE s.organization_id = ?
              AND s.removed_at IS NULL
            ORDER BY s.updated_at DESC, s.id ASC
          `
        )
        .bind(actor.userId, actor.organizationId)
        .all<
          SkillRow & {
            is_maintainer: number;
            release_created_at: number;
            release_created_by_user_id: string;
            release_digest: string;
            release_id: string;
            release_source_commit_sha: string | null;
            release_source_kind: "created" | "github";
            release_source_path: string | null;
            release_source_repository: string | null;
          }
        >();
      return rows.results.map((row) =>
        parseSummary({
          activeRelease: {
            createdAt: toIso(row.release_created_at),
            createdByUserId: row.release_created_by_user_id,
            digest: row.release_digest,
            id: row.release_id,
            source: sourceFromColumns({
              commitSha: row.release_source_commit_sha,
              kind: row.release_source_kind,
              path: row.release_source_path,
              repository: row.release_source_repository,
            }),
          },
          createdAt: toIso(row.created_at),
          description: row.description,
          enabled: row.enabled === 1,
          id: row.id,
          name: row.name,
          organizationId: row.organization_id,
          permissions: permissions(actor, row.is_maintainer === 1),
          source: sourceFromSkill(row),
          updatedAt: toIso(row.updated_at),
          version: row.version,
        })
      );
    },

    async readRuntimeSnapshot(
      organizationId: string,
      selectedReleases?: OrganizationSkillRuntimeReleaseSelection[]
    ): Promise<OrganizationSkillRuntimeSnapshotResponse> {
      const selection =
        selectedReleases ??
        (await readEnabledOrganizationSkillReleaseSelection({
          db: dependencies.db,
          organizationId,
        }));
      const rows = await Promise.all(
        selection.map(async (selected) => {
          const release = await dependencies.db
            .prepare(
              `
                SELECT *
                FROM organization_skill_releases
                WHERE organization_id = ?
                  AND skill_id = ?
                  AND id = ?
                LIMIT 1
              `
            )
            .bind(organizationId, selected.skillId, selected.releaseId)
            .first<ReleaseRow>();
          if (!(release && release.digest === selected.digest)) {
            throw createCoreRpcHttpError({
              code: "organization_skill.release_missing",
              reason: "The selected Skill release is unavailable.",
              status: 503,
            });
          }
          return { release, selected };
        })
      );
      const releases = await Promise.all(
        rows.map(async ({ release, selected }) => {
          const bundle = await readReleaseBundle(dependencies.bucket, release);
          if (bundle.portable.name !== selected.name) {
            throw createCoreRpcHttpError({
              code: "organization_skill.release_invalid",
              reason: "The selected Skill release name is inconsistent.",
              status: 503,
            });
          }
          return {
            bundle,
            digest: release.digest,
            releaseId: release.id,
            skillId: release.skill_id,
          };
        })
      );
      return organizationSkillRuntimeSnapshotResponseSchema.parse({
        organizationId,
        releases,
      });
    },

    async remove(
      actor: OrganizationSkillActor,
      skillId: string,
      expectedVersion: number
    ): Promise<void> {
      requireManager(actor);
      requireExpectedVersion(
        await requireSkill(dependencies.db, actor.organizationId, skillId),
        expectedVersion
      );
      const result = await dependencies.db
        .prepare(
          `
            UPDATE organization_skills
            SET removed_at = ?,
                enabled = 0,
                updated_at = ?,
                version = version + 1
            WHERE id = ?
              AND organization_id = ?
              AND removed_at IS NULL
              AND version = ?
          `
        )
        .bind(now(), now(), skillId, actor.organizationId, expectedVersion)
        .run();
      requireOneChange(result, "This Skill changed before it was removed.");
    },

    async setEnabled(
      actor: OrganizationSkillActor,
      skillId: string,
      enabled: boolean,
      expectedVersion: number
    ): Promise<OrganizationSkill> {
      requireManager(actor);
      const existing = await requireSkill(
        dependencies.db,
        actor.organizationId,
        skillId
      );
      requireExpectedVersion(existing, expectedVersion);
      const isEnabling = enabled && existing.enabled !== 1;
      const releaseRuntimeBytes = isEnabling
        ? readReleaseRuntimeBytes(
            await requireRelease(dependencies.db, existing)
          )
        : 0;
      if (isEnabling) {
        await requireRuntimeCatalogCapacity({
          additionalRuntimeBytes: releaseRuntimeBytes,
          db: dependencies.db,
          organizationId: actor.organizationId,
        });
      }
      const result = await dependencies.db
        .prepare(
          `
            UPDATE organization_skills
            SET enabled = ?,
                updated_at = ?,
                version = version + 1
            WHERE id = ?
              AND organization_id = ?
              AND removed_at IS NULL
              AND version = ?
              AND (
                ? = 0
                OR enabled = 1
                OR (
                  (
                    SELECT COUNT(*)
                    FROM organization_skills enabled_skill
                    WHERE enabled_skill.organization_id = ?
                      AND enabled_skill.enabled = 1
                      AND enabled_skill.removed_at IS NULL
                  ) < ?
                  AND (
                    SELECT COALESCE(
                      SUM(
                        COALESCE(
                          CAST(
                            json_extract(
                              active_release.manifest_json,
                              '$.runtimeBytes'
                            ) AS INTEGER
                          ),
                          ${ORGANIZATION_SKILL_RUNTIME_CATALOG_MAX_BYTES + 1}
                        )
                      ),
                      0
                    )
                    FROM organization_skills enabled_skill
                    JOIN organization_skill_releases active_release
                      ON active_release.id = enabled_skill.active_release_id
                     AND active_release.skill_id = enabled_skill.id
                     AND active_release.organization_id = enabled_skill.organization_id
                    WHERE enabled_skill.organization_id = ?
                      AND enabled_skill.enabled = 1
                      AND enabled_skill.removed_at IS NULL
                  ) + ? <= ?
                )
              )
          `
        )
        .bind(
          enabled ? 1 : 0,
          now(),
          skillId,
          actor.organizationId,
          expectedVersion,
          isEnabling ? 1 : 0,
          actor.organizationId,
          ORGANIZATION_SKILL_RUNTIME_RELEASE_LIMIT,
          actor.organizationId,
          releaseRuntimeBytes,
          ORGANIZATION_SKILL_RUNTIME_CATALOG_MAX_BYTES
        )
        .run();
      if (result.meta.changes !== 1) {
        const current = await requireSkill(
          dependencies.db,
          actor.organizationId,
          skillId
        );
        requireExpectedVersion(current, expectedVersion);
        if (isEnabling) {
          await requireRuntimeCatalogCapacity({
            additionalRuntimeBytes: releaseRuntimeBytes,
            db: dependencies.db,
            organizationId: actor.organizationId,
          });
        }
        throw conflictError("This Skill changed before it was updated.");
      }
      return await this.get(actor, skillId);
    },

    async setMaintainers(
      actor: OrganizationSkillActor,
      skillId: string,
      maintainerUserIds: string[],
      expectedVersion: number
    ): Promise<OrganizationSkill> {
      requireManager(actor);
      requireExpectedVersion(
        await requireSkill(dependencies.db, actor.organizationId, skillId),
        expectedVersion
      );
      const uniqueUserIds = [...new Set(maintainerUserIds)];
      await requireCurrentMembers(
        dependencies.db,
        actor.organizationId,
        uniqueUserIds
      );
      const nextVersion = expectedVersion + 1;
      const updateToken = newId();
      const statements = [
        dependencies.db
          .prepare(
            `
              UPDATE organization_skills
              SET updated_at = ?,
                  version = version + 1,
                  maintainer_update_token = ?
              WHERE id = ?
                AND organization_id = ?
                AND removed_at IS NULL
                AND version = ?
                AND maintainer_update_token IS NULL
            `
          )
          .bind(
            now(),
            updateToken,
            skillId,
            actor.organizationId,
            expectedVersion
          ),
        dependencies.db
          .prepare(
            `
              DELETE FROM organization_skill_maintainers
              WHERE organization_id = ?
                AND skill_id = ?
                AND EXISTS (
                  SELECT 1
                  FROM organization_skills
                  WHERE id = ?
                    AND organization_id = ?
                    AND removed_at IS NULL
                    AND version = ?
                    AND maintainer_update_token = ?
                )
            `
          )
          .bind(
            actor.organizationId,
            skillId,
            skillId,
            actor.organizationId,
            nextVersion,
            updateToken
          ),
        ...uniqueUserIds.map((userId) =>
          dependencies.db
            .prepare(
              `
                INSERT INTO organization_skill_maintainers (
                  assigned_at,
                  assigned_by_user_id,
                  organization_id,
                  skill_id,
                  user_id
                )
                SELECT ?, ?, ?, ?, ?
                WHERE EXISTS (
                  SELECT 1
                  FROM organization_skills
                  WHERE id = ?
                    AND organization_id = ?
                    AND removed_at IS NULL
                    AND version = ?
                    AND maintainer_update_token = ?
                )
              `
            )
            .bind(
              now(),
              actor.userId,
              actor.organizationId,
              skillId,
              userId,
              skillId,
              actor.organizationId,
              nextVersion,
              updateToken
            )
        ),
        dependencies.db
          .prepare(
            `
              UPDATE organization_skills
              SET maintainer_update_token = NULL
              WHERE id = ?
                AND organization_id = ?
                AND removed_at IS NULL
                AND version = ?
                AND maintainer_update_token = ?
            `
          )
          .bind(skillId, actor.organizationId, nextVersion, updateToken),
      ];
      const results = await dependencies.db.batch(statements);
      const skillUpdate = results[0];
      const maintainerInserts = results.slice(2, -1);
      const skillFinalization = results.at(-1);
      if (
        !skillUpdate ||
        skillUpdate.meta.changes !== 1 ||
        !skillFinalization ||
        skillFinalization.meta.changes !== 1 ||
        maintainerInserts.some((result) => result.meta.changes !== 1)
      ) {
        throw conflictError(
          "This Skill changed before its Maintainers were updated."
        );
      }
      return await this.get(actor, skillId);
    },

    async update(
      actor: OrganizationSkillActor,
      skillId: string,
      input: {
        bundle: OrganizationSkillBundle;
        expectedActiveReleaseId: string;
        expectedVersion: number;
      }
    ): Promise<OrganizationSkill> {
      const existing = await requireSkill(
        dependencies.db,
        actor.organizationId,
        skillId
      );
      const isMaintainer = await readIsMaintainer(
        dependencies.db,
        actor,
        skillId
      );
      requireEditor(actor, isMaintainer);
      if (
        existing.version !== input.expectedVersion ||
        existing.active_release_id !== input.expectedActiveReleaseId
      ) {
        throw conflictError(
          "This Skill changed while you were editing. Your changes were not saved."
        );
      }
      const bundle = parseBundle(input.bundle);
      const source = sourceFromSkill(existing);
      const releaseId = newId();
      const objectKey = releaseObjectKey(
        actor.organizationId,
        skillId,
        releaseId
      );
      const serialized = stringifyOrganizationSkillBundleCanonicalJson(bundle);
      const runtimeBytes = new TextEncoder().encode(serialized).byteLength;
      const digest = await sha256(serialized);
      const currentRelease = await requireRelease(dependencies.db, existing);
      if (currentRelease.digest === digest) {
        return await this.get(actor, skillId);
      }
      await requireEnabledSkillRuntimeCatalogReplacementCapacity({
        additionalRuntimeBytes: runtimeBytes,
        db: dependencies.db,
        organizationId: actor.organizationId,
        skill: existing,
      });
      const releaseObjectCreated = await writeReleaseObject(
        dependencies.bucket,
        objectKey,
        digest,
        serialized
      );
      const timestamp = now();
      const sourceColumns = columnsFromSource(source);
      let results: D1Result<unknown>[];
      try {
        results = await dependencies.db.batch([
          dependencies.db
            .prepare(
              `
              INSERT INTO organization_skill_releases (
                created_at,
                created_by_user_id,
                digest,
                id,
                manifest_json,
                object_key,
                organization_id,
                skill_id,
                source_commit_sha,
                source_kind,
                source_path,
                source_repository
              )
              SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
              WHERE EXISTS (
                SELECT 1
                FROM organization_skills current_skill
                WHERE current_skill.id = ?
                  AND current_skill.organization_id = ?
                  AND current_skill.removed_at IS NULL
                  AND current_skill.active_release_id = ?
                  AND current_skill.version = ?
                  AND (
                    current_skill.enabled = 0
                    OR (
                      (
                        SELECT COUNT(*)
                        FROM organization_skills enabled_skill
                        WHERE enabled_skill.organization_id = current_skill.organization_id
                          AND enabled_skill.id <> current_skill.id
                          AND enabled_skill.enabled = 1
                          AND enabled_skill.removed_at IS NULL
                      ) < ?
                      AND (
                        SELECT COALESCE(
                          SUM(
                            COALESCE(
                              CAST(
                                json_extract(
                                  active_release.manifest_json,
                                  '$.runtimeBytes'
                                ) AS INTEGER
                              ),
                              ${ORGANIZATION_SKILL_RUNTIME_CATALOG_MAX_BYTES + 1}
                            )
                          ),
                          0
                        )
                        FROM organization_skills enabled_skill
                        JOIN organization_skill_releases active_release
                          ON active_release.id = enabled_skill.active_release_id
                         AND active_release.skill_id = enabled_skill.id
                         AND active_release.organization_id = enabled_skill.organization_id
                        WHERE enabled_skill.organization_id = current_skill.organization_id
                          AND enabled_skill.id <> current_skill.id
                          AND enabled_skill.enabled = 1
                          AND enabled_skill.removed_at IS NULL
                      ) + ? <= ?
                    )
                  )
              )
              `
            )
            .bind(
              timestamp,
              actor.userId,
              digest,
              releaseId,
              manifestJson(bundle),
              objectKey,
              actor.organizationId,
              skillId,
              sourceColumns.commitSha,
              sourceColumns.kind,
              sourceColumns.path,
              sourceColumns.repository,
              skillId,
              actor.organizationId,
              input.expectedActiveReleaseId,
              input.expectedVersion,
              ORGANIZATION_SKILL_RUNTIME_RELEASE_LIMIT,
              runtimeBytes,
              ORGANIZATION_SKILL_RUNTIME_CATALOG_MAX_BYTES
            ),
          dependencies.db
            .prepare(
              `
              UPDATE organization_skills
              SET active_release_id = ?,
                  description = ?,
                  name = ?,
                  updated_at = ?,
                  version = version + 1
              WHERE id = ?
                AND organization_id = ?
                AND removed_at IS NULL
                AND active_release_id = ?
                AND version = ?
                AND EXISTS (
                  SELECT 1
                  FROM organization_skill_releases
                  WHERE id = ?
                    AND skill_id = ?
                    AND organization_id = ?
                )
              `
            )
            .bind(
              releaseId,
              bundle.portable.description,
              bundle.portable.name,
              timestamp,
              skillId,
              actor.organizationId,
              input.expectedActiveReleaseId,
              input.expectedVersion,
              releaseId,
              skillId,
              actor.organizationId
            ),
        ]);
      } catch (error) {
        if (releaseObjectCreated) {
          await deleteUncommittedReleaseObject(
            dependencies.bucket,
            objectKey,
            releaseId
          );
        }
        if (isNameConflict(error)) {
          throw nameConflictError();
        }
        throw error;
      }
      const [insertRelease, updateSkill] = results;
      if (
        !(insertRelease && updateSkill) ||
        insertRelease.meta.changes !== 1 ||
        updateSkill.meta.changes !== 1
      ) {
        if (releaseObjectCreated) {
          await deleteUncommittedReleaseObject(
            dependencies.bucket,
            objectKey,
            releaseId
          );
        }
        await throwOrganizationSkillUpdateFailure({
          actor,
          db: dependencies.db,
          expectedActiveReleaseId: input.expectedActiveReleaseId,
          expectedVersion: input.expectedVersion,
          runtimeBytes,
          skillId,
        });
      }
      return await this.get(actor, skillId);
    },
  };
}

async function createSkill(input: {
  actor: OrganizationSkillActor;
  bundle: OrganizationSkillBundle;
  dependencies: OrganizationSkillServiceDependencies;
  newId: () => string;
  now: () => number;
  source: OrganizationSkillSource;
}): Promise<OrganizationSkill> {
  const skillId = input.newId();
  const releaseId = input.newId();
  const objectKey = releaseObjectKey(
    input.actor.organizationId,
    skillId,
    releaseId
  );
  const serialized = stringifyOrganizationSkillBundleCanonicalJson(
    input.bundle
  );
  const runtimeBytes = new TextEncoder().encode(serialized).byteLength;
  const digest = await sha256(serialized);
  await requireRuntimeCatalogCapacity({
    additionalRuntimeBytes: runtimeBytes,
    db: input.dependencies.db,
    organizationId: input.actor.organizationId,
  });
  const releaseObjectCreated = await writeReleaseObject(
    input.dependencies.bucket,
    objectKey,
    digest,
    serialized
  );
  const timestamp = input.now();
  const source = columnsFromSource(input.source);
  try {
    const [skillInsert, releaseInsert] = await input.dependencies.db.batch([
      input.dependencies.db
        .prepare(
          `
            INSERT INTO organization_skills (
              active_release_id,
              created_at,
              created_by_user_id,
              description,
              enabled,
              id,
              name,
              organization_id,
              removed_at,
              source_commit_sha,
              source_kind,
              source_path,
              source_repository,
              updated_at,
              version
            )
            SELECT ?, ?, ?, ?, 1, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 1
            WHERE (
              SELECT COUNT(*)
              FROM organization_skills enabled_skill
              WHERE enabled_skill.organization_id = ?
                AND enabled_skill.enabled = 1
                AND enabled_skill.removed_at IS NULL
            ) < ?
              AND (
                SELECT COALESCE(
                  SUM(
                    COALESCE(
                      CAST(
                        json_extract(
                          active_release.manifest_json,
                          '$.runtimeBytes'
                        ) AS INTEGER
                      ),
                      ${ORGANIZATION_SKILL_RUNTIME_CATALOG_MAX_BYTES + 1}
                    )
                  ),
                  0
                )
                FROM organization_skills enabled_skill
                JOIN organization_skill_releases active_release
                  ON active_release.id = enabled_skill.active_release_id
                 AND active_release.skill_id = enabled_skill.id
                 AND active_release.organization_id = enabled_skill.organization_id
                WHERE enabled_skill.organization_id = ?
                  AND enabled_skill.enabled = 1
                  AND enabled_skill.removed_at IS NULL
              ) + ? <= ?
          `
        )
        .bind(
          releaseId,
          timestamp,
          input.actor.userId,
          input.bundle.portable.description,
          skillId,
          input.bundle.portable.name,
          input.actor.organizationId,
          source.commitSha,
          source.kind,
          source.path,
          source.repository,
          timestamp,
          input.actor.organizationId,
          ORGANIZATION_SKILL_RUNTIME_RELEASE_LIMIT,
          input.actor.organizationId,
          runtimeBytes,
          ORGANIZATION_SKILL_RUNTIME_CATALOG_MAX_BYTES
        ),
      input.dependencies.db
        .prepare(
          `
            INSERT INTO organization_skill_releases (
              created_at,
              created_by_user_id,
              digest,
              id,
              manifest_json,
              object_key,
              organization_id,
              skill_id,
              source_commit_sha,
              source_kind,
              source_path,
              source_repository
            )
            SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            WHERE EXISTS (
              SELECT 1
              FROM organization_skills
              WHERE id = ?
                AND organization_id = ?
                AND removed_at IS NULL
                AND active_release_id = ?
            )
          `
        )
        .bind(
          timestamp,
          input.actor.userId,
          digest,
          releaseId,
          manifestJson(input.bundle),
          objectKey,
          input.actor.organizationId,
          skillId,
          source.commitSha,
          source.kind,
          source.path,
          source.repository,
          skillId,
          input.actor.organizationId,
          releaseId
        ),
    ]);
    if (
      !(skillInsert && releaseInsert) ||
      skillInsert.meta.changes !== 1 ||
      releaseInsert.meta.changes !== 1
    ) {
      await requireRuntimeCatalogCapacity({
        additionalRuntimeBytes: runtimeBytes,
        db: input.dependencies.db,
        organizationId: input.actor.organizationId,
      });
      throw new Error("Organization Skill insert did not complete.");
    }
  } catch (error) {
    const replay = await readExactCreatedSkillReplay({
      actor: input.actor,
      bundle: input.bundle,
      db: input.dependencies.db,
      digest,
      objectKey,
      releaseId,
      skillId,
      source: input.source,
    });
    if (replay) {
      return await buildSkill({
        actor: input.actor,
        bucket: input.dependencies.bucket,
        db: input.dependencies.db,
        skill: replay,
      });
    }
    if (releaseObjectCreated) {
      await deleteUncommittedReleaseObject(
        input.dependencies.bucket,
        objectKey,
        releaseId
      );
    }
    if (isNameConflict(error)) {
      throw nameConflictError();
    }
    throw error;
  }
  return await buildSkill({
    actor: input.actor,
    bucket: input.dependencies.bucket,
    db: input.dependencies.db,
    skill: await requireSkill(
      input.dependencies.db,
      input.actor.organizationId,
      skillId
    ),
  });
}

async function buildSkill(input: {
  actor: OrganizationSkillReadActor;
  bucket: R2Bucket;
  db: D1Database;
  skill: SkillRow;
}): Promise<OrganizationSkill> {
  const [release, releases, maintainers, isMaintainer] = await Promise.all([
    requireRelease(input.db, input.skill),
    input.db
      .prepare(
        `
          SELECT *
          FROM organization_skill_releases
          WHERE organization_id = ? AND skill_id = ?
          ORDER BY created_at DESC, id DESC
        `
      )
      .bind(input.actor.organizationId, input.skill.id)
      .all<ReleaseRow>(),
    input.db
      .prepare(
        `
          SELECT maintainer.user_id
          FROM organization_skill_maintainers maintainer
          JOIN members member
            ON member.organization_id = maintainer.organization_id
           AND member.user_id = maintainer.user_id
           AND member.created_at <= maintainer.assigned_at
          WHERE maintainer.organization_id = ?
            AND maintainer.skill_id = ?
          ORDER BY maintainer.assigned_at ASC, maintainer.user_id ASC
        `
      )
      .bind(input.actor.organizationId, input.skill.id)
      .all<{ user_id: string }>(),
    readIsMaintainer(input.db, input.actor, input.skill.id),
  ]);
  return organizationSkillSchema.parse({
    ...parseSummary({
      activeRelease: releaseSummary(release),
      createdAt: toIso(input.skill.created_at),
      description: input.skill.description,
      enabled: input.skill.enabled === 1,
      id: input.skill.id,
      name: input.skill.name,
      organizationId: input.skill.organization_id,
      permissions: permissions(input.actor, isMaintainer),
      source: sourceFromSkill(input.skill),
      updatedAt: toIso(input.skill.updated_at),
      version: input.skill.version,
    }),
    bundle: await readReleaseBundle(input.bucket, release),
    maintainerUserIds: maintainers.results.map((row) => row.user_id),
    releases: releases.results.map(releaseSummary),
  });
}

async function requireSkill(
  db: D1Database,
  organizationId: string,
  skillId: string
): Promise<SkillRow> {
  const row = await db
    .prepare(
      `
        SELECT *
        FROM organization_skills
        WHERE id = ?
          AND organization_id = ?
          AND removed_at IS NULL
        LIMIT 1
      `
    )
    .bind(skillId, organizationId)
    .first<SkillRow>();
  if (!row) {
    throw createCoreRpcHttpError({
      code: "organization_skill.not_found",
      reason: "Organization Skill not found.",
      status: 404,
    });
  }
  return row;
}

async function requireRelease(
  db: D1Database,
  skill: SkillRow
): Promise<ReleaseRow> {
  const release = await db
    .prepare(
      `
        SELECT *
        FROM organization_skill_releases
        WHERE id = ?
          AND skill_id = ?
          AND organization_id = ?
        LIMIT 1
      `
    )
    .bind(skill.active_release_id, skill.id, skill.organization_id)
    .first<ReleaseRow>();
  if (!release) {
    throw createCoreRpcHttpError({
      code: "organization_skill.release_missing",
      reason: "The active Skill release is unavailable.",
      status: 500,
    });
  }
  return release;
}

async function readReleaseBundle(
  bucket: R2Bucket,
  release: ReleaseRow
): Promise<OrganizationSkillBundle> {
  const object = await bucket.get(release.object_key);
  if (!object) {
    throw createCoreRpcHttpError({
      code: "organization_skill.release_object_missing",
      reason: "The active Skill release content is unavailable.",
      status: 503,
    });
  }
  const serialized = await object.text();
  const digest = await sha256(serialized);
  if (digest !== release.digest) {
    throw createCoreRpcHttpError({
      code: "organization_skill.release_digest_mismatch",
      reason: "The active Skill release failed its integrity check.",
      status: 503,
    });
  }
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw createCoreRpcHttpError({
      code: "organization_skill.release_invalid",
      reason: "The active Skill release content is invalid.",
      status: 503,
    });
  }
  const parsed = organizationSkillBundleSchema.safeParse(value);
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "organization_skill.release_invalid",
      reason: "The active Skill release content is invalid.",
      status: 503,
    });
  }
  return parsed.data;
}

async function writeReleaseObject(
  bucket: R2Bucket,
  objectKey: string,
  digest: string,
  serialized: string
): Promise<boolean> {
  const existing = await bucket.get(objectKey);
  if (existing) {
    const existingSerialized = await existing.text();
    if (
      existing.customMetadata?.digest === digest &&
      existingSerialized === serialized
    ) {
      return false;
    }
    throw new Error(
      `Organization Skill release object already exists: ${objectKey}`
    );
  }
  await bucket.put(objectKey, serialized, {
    customMetadata: { digest },
    httpMetadata: { contentType: "application/json; charset=utf-8" },
  });
  return true;
}

async function readExactCreatedSkillReplay(input: {
  actor: OrganizationSkillActor;
  bundle: OrganizationSkillBundle;
  db: D1Database;
  digest: string;
  objectKey: string;
  releaseId: string;
  skillId: string;
  source: OrganizationSkillSource;
}): Promise<SkillRow | null> {
  const source = columnsFromSource(input.source);
  return await input.db
    .prepare(
      `
        SELECT s.*
        FROM organization_skills s
        JOIN organization_skill_releases r
          ON r.id = s.active_release_id
         AND r.skill_id = s.id
         AND r.organization_id = s.organization_id
        WHERE s.id = ?
          AND s.organization_id = ?
          AND s.created_by_user_id = ?
          AND s.active_release_id = ?
          AND s.name = ?
          AND s.description = ?
          AND s.removed_at IS NULL
          AND r.id = ?
          AND r.digest = ?
          AND r.object_key = ?
          AND r.manifest_json = ?
          AND r.source_kind = ?
          AND r.source_repository IS ?
          AND r.source_path IS ?
          AND r.source_commit_sha IS ?
        LIMIT 1
      `
    )
    .bind(
      input.skillId,
      input.actor.organizationId,
      input.actor.userId,
      input.releaseId,
      input.bundle.portable.name,
      input.bundle.portable.description,
      input.releaseId,
      input.digest,
      input.objectKey,
      manifestJson(input.bundle),
      source.kind,
      source.repository,
      source.path,
      source.commitSha
    )
    .first<SkillRow>();
}

async function deleteUncommittedReleaseObject(
  bucket: R2Bucket,
  objectKey: string,
  releaseId: string
): Promise<void> {
  try {
    await bucket.delete(objectKey);
  } catch (error) {
    console.error("[core.organization_skill.release_cleanup_failed]", {
      error: error instanceof Error ? error.message : String(error),
      objectKey,
      releaseId,
    });
  }
}

async function readIsMaintainer(
  db: D1Database,
  actor: OrganizationSkillReadActor,
  skillId: string
): Promise<boolean> {
  const row = await db
    .prepare(
      `
        SELECT 1
        FROM organization_skill_maintainers m
        JOIN members member
          ON member.organization_id = m.organization_id
         AND member.user_id = m.user_id
         AND member.created_at <= m.assigned_at
        WHERE m.organization_id = ?
          AND m.skill_id = ?
          AND m.user_id = ?
        LIMIT 1
      `
    )
    .bind(actor.organizationId, skillId, actor.userId)
    .first();
  return row !== null;
}

async function requireCurrentMembers(
  db: D1Database,
  organizationId: string,
  userIds: string[]
): Promise<void> {
  if (userIds.length === 0) {
    return;
  }
  const placeholders = userIds.map(() => "?").join(", ");
  const result = await db
    .prepare(
      `
        SELECT user_id
        FROM members
        WHERE organization_id = ?
          AND user_id IN (${placeholders})
      `
    )
    .bind(organizationId, ...userIds)
    .all<{ user_id: string }>();
  if (
    new Set(result.results.map((row) => row.user_id)).size !== userIds.length
  ) {
    throw createCoreRpcHttpError({
      code: "organization_skill.maintainer_not_member",
      reason: "Every Skill Maintainer must be a current Organization member.",
      status: 400,
    });
  }
}

function requireManager(actor: OrganizationSkillActor): void {
  if (actor.role === "owner" || actor.role === "admin") {
    return;
  }
  throw createCoreRpcHttpError({
    code: "organization_skill.manage_forbidden",
    reason: "Only Organization owners and admins can manage Skills.",
    status: 403,
  });
}

function requireExpectedVersion(
  skill: SkillRow,
  expectedVersion: number
): void {
  if (skill.version !== expectedVersion) {
    throw conflictError("This Skill changed before the request was applied.");
  }
}

function isNameConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("organization_skills_org_name_active_unique") ||
    message.includes(
      "UNIQUE constraint failed: organization_skills.organization_id, organization_skills.name"
    )
  );
}

function nameConflictError() {
  return createCoreRpcHttpError({
    code: "organization_skill.name_exists",
    reason: "A Skill with this name already exists in the Organization.",
    status: 409,
  });
}

function requireEditor(
  actor: OrganizationSkillActor,
  isMaintainer: boolean
): void {
  if (actor.role === "owner" || actor.role === "admin" || isMaintainer) {
    return;
  }
  throw createCoreRpcHttpError({
    code: "organization_skill.edit_forbidden",
    reason: "You do not have permission to edit this Skill.",
    status: 403,
  });
}

function permissions(
  actor: OrganizationSkillReadActor,
  isMaintainer: boolean
): { canEdit: boolean; canManage: boolean } {
  const canManage = actor.role === "owner" || actor.role === "admin";
  return { canEdit: canManage || isMaintainer, canManage };
}

function parseBundle(value: unknown): OrganizationSkillBundle {
  const parsed = organizationSkillBundleSchema.safeParse(value);
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "organization_skill.invalid_bundle",
      reason: parsed.error.issues[0]?.message ?? "The Skill bundle is invalid.",
      status: 400,
    });
  }
  return parsed.data;
}

function parseSummary(value: unknown): OrganizationSkillSummary {
  return organizationSkillSummarySchema.parse(value);
}

function releaseSummary(release: ReleaseRow) {
  return {
    createdAt: toIso(release.created_at),
    createdByUserId: release.created_by_user_id,
    digest: release.digest,
    id: release.id,
    source: sourceFromColumns({
      commitSha: release.source_commit_sha,
      kind: release.source_kind,
      path: release.source_path,
      repository: release.source_repository,
    }),
  };
}

function sourceFromSkill(skill: SkillRow): OrganizationSkillSource {
  return sourceFromColumns({
    commitSha: skill.source_commit_sha,
    kind: skill.source_kind,
    path: skill.source_path,
    repository: skill.source_repository,
  });
}

function sourceFromColumns(input: {
  commitSha: string | null;
  kind: "created" | "github";
  path: string | null;
  repository: string | null;
}): OrganizationSkillSource {
  if (input.kind === "created") {
    return { kind: "created" };
  }
  if (!(input.commitSha && input.path !== null && input.repository)) {
    throw new Error("GitHub Organization Skill provenance is incomplete.");
  }
  return {
    commitSha: input.commitSha,
    kind: "github",
    path: input.path,
    repository: input.repository,
  };
}

function columnsFromSource(source: OrganizationSkillSource) {
  return source.kind === "created"
    ? {
        commitSha: null,
        kind: source.kind,
        path: null,
        repository: null,
      }
    : {
        commitSha: source.commitSha,
        kind: source.kind,
        path: source.path,
        repository: source.repository,
      };
}

async function requireRuntimeCatalogCapacity(input: {
  additionalRuntimeBytes: number;
  db: D1Database;
  excludedSkillId?: string;
  organizationId: string;
}): Promise<void> {
  const usage = await input.db
    .prepare(
      `
        SELECT COUNT(*) AS enabled_releases,
               COALESCE(
                 SUM(
                   COALESCE(
                     CAST(
                       json_extract(
                         active_release.manifest_json,
                         '$.runtimeBytes'
                       ) AS INTEGER
                     ),
                     ${ORGANIZATION_SKILL_RUNTIME_CATALOG_MAX_BYTES + 1}
                   )
                 ),
                 0
               ) AS runtime_bytes
        FROM organization_skills enabled_skill
        JOIN organization_skill_releases active_release
          ON active_release.id = enabled_skill.active_release_id
         AND active_release.skill_id = enabled_skill.id
         AND active_release.organization_id = enabled_skill.organization_id
        WHERE enabled_skill.organization_id = ?
          AND enabled_skill.enabled = 1
          AND enabled_skill.removed_at IS NULL
          AND (? IS NULL OR enabled_skill.id <> ?)
      `
    )
    .bind(
      input.organizationId,
      input.excludedSkillId ?? null,
      input.excludedSkillId ?? null
    )
    .first<RuntimeCatalogUsage>();
  const enabledReleases = Number(usage?.enabled_releases ?? 0);
  const runtimeBytes = Number(usage?.runtime_bytes ?? 0);
  if (enabledReleases >= ORGANIZATION_SKILL_RUNTIME_RELEASE_LIMIT) {
    throw runtimeReleaseLimitError();
  }
  if (
    runtimeBytes + input.additionalRuntimeBytes >
    ORGANIZATION_SKILL_RUNTIME_CATALOG_MAX_BYTES
  ) {
    throw runtimeCatalogTooLargeError();
  }
}

async function requireEnabledSkillRuntimeCatalogReplacementCapacity(input: {
  additionalRuntimeBytes: number;
  db: D1Database;
  organizationId: string;
  skill: SkillRow;
}): Promise<void> {
  if (input.skill.enabled !== 1) {
    return;
  }
  await requireRuntimeCatalogCapacity({
    additionalRuntimeBytes: input.additionalRuntimeBytes,
    db: input.db,
    excludedSkillId: input.skill.id,
    organizationId: input.organizationId,
  });
}

async function throwOrganizationSkillUpdateFailure(input: {
  actor: OrganizationSkillActor;
  db: D1Database;
  expectedActiveReleaseId: string;
  expectedVersion: number;
  runtimeBytes: number;
  skillId: string;
}): Promise<never> {
  const current = await requireSkill(
    input.db,
    input.actor.organizationId,
    input.skillId
  );
  if (
    current.version !== input.expectedVersion ||
    current.active_release_id !== input.expectedActiveReleaseId
  ) {
    throw conflictError(
      "This Skill changed while you were editing. Your changes were not saved."
    );
  }
  await requireEnabledSkillRuntimeCatalogReplacementCapacity({
    additionalRuntimeBytes: input.runtimeBytes,
    db: input.db,
    organizationId: input.actor.organizationId,
    skill: current,
  });
  throw conflictError(
    "This Skill changed while you were editing. Your changes were not saved."
  );
}

function readReleaseRuntimeBytes(release: ReleaseRow): number {
  return readManifestRuntimeBytes(release.manifest_json);
}

function readManifestRuntimeBytes(manifestJson: string): number {
  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestJson);
  } catch {
    throw invalidReleaseManifestError();
  }
  const runtimeBytes =
    manifest && typeof manifest === "object"
      ? (manifest as { runtimeBytes?: unknown }).runtimeBytes
      : undefined;
  if (
    !Number.isInteger(runtimeBytes) ||
    Number(runtimeBytes) < 0 ||
    Number(runtimeBytes) > ORGANIZATION_SKILL_RUNTIME_CATALOG_MAX_BYTES
  ) {
    throw invalidReleaseManifestError();
  }
  return Number(runtimeBytes);
}

function invalidReleaseManifestError(): Error {
  return createCoreRpcHttpError({
    code: "organization_skill.release_invalid",
    reason: "The active Skill release manifest is invalid.",
    status: 503,
  });
}

function manifestJson(bundle: OrganizationSkillBundle): string {
  const runtimeBytes = new TextEncoder().encode(
    stringifyOrganizationSkillBundleCanonicalJson(bundle)
  ).byteLength;
  return canonicalJson({
    files: bundle.files.map(({ encoding, mediaType, path, size }) => ({
      encoding,
      mediaType,
      path,
      size,
    })),
    runtimeBytes,
  });
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortJson(item)])
    );
  }
  return value;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function releaseObjectKey(
  organizationId: string,
  skillId: string,
  releaseId: string
): string {
  return `organizations/${organizationId}/skills/${skillId}/releases/${releaseId}.json`;
}

function toIso(value: number): string {
  return new Date(value).toISOString();
}

function runtimeReleaseLimitError(): Error {
  return createCoreRpcHttpError({
    code: "organization_skill.runtime_release_limit",
    reason: `At most ${ORGANIZATION_SKILL_RUNTIME_RELEASE_LIMIT} Organization Skills can be enabled at one time.`,
    status: 409,
  });
}

function runtimeCatalogTooLargeError(): Error {
  return createCoreRpcHttpError({
    code: "organization_skill.runtime_catalog_too_large",
    reason:
      "Disable another Organization Skill before enabling this one. The enabled Skill catalog is too large to load safely.",
    status: 409,
  });
}

function requireOneChange(result: D1Result<unknown>, reason: string): void {
  if (result.meta.changes === 1) {
    return;
  }
  throw conflictError(reason);
}

function conflictError(reason: string) {
  return createCoreRpcHttpError({
    code: "organization_skill.version_conflict",
    reason,
    status: 409,
  });
}
