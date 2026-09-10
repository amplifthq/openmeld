import { env } from "cloudflare:test";
import {
  HOSTED_CENTER_AGENT_CONTROLLER_REF,
  ORGANIZATION_SKILL_BUNDLE_MAX_BYTES,
  ORGANIZATION_SKILL_RUNTIME_CATALOG_MAX_BYTES,
  ORGANIZATION_SKILL_RUNTIME_RELEASE_LIMIT,
} from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import {
  rpcCenterAgentInstallOrganizationSkill,
  rpcCenterAgentReadOrganizationSkills,
} from "../src/organization-skills/center-agent-organization-skill-rpc";
import { importOrganizationSkillBundleFromGitHub } from "../src/organization-skills/github-skill-import";
import {
  createOrganizationSkillService,
  type OrganizationSkillActor,
  readEnabledOrganizationSkillReleaseSelection,
} from "../src/organization-skills/organization-skill-service";

describe("Organization Skills", () => {
  it("keeps management with owners and admins while assigned maintainers can edit", async () => {
    const fixture = await seedFixture();
    const service = createService();
    const created = await service.create(fixture.owner, {
      description: "Review a release before it ships.",
      instructions: "Check the release evidence.",
      name: "release-review",
    });
    const frozenSelection = await readEnabledOrganizationSkillReleaseSelection({
      db: env.OPENMELD_DB,
      organizationId: fixture.organizationId,
    });

    await expect(service.list(fixture.member)).resolves.toMatchObject([
      {
        id: created.id,
        permissions: { canEdit: false, canManage: false },
      },
    ]);
    await expect(
      service.update(fixture.member, created.id, {
        bundle: {
          ...created.bundle,
          instructions: "Unauthorized edit.",
        },
        expectedActiveReleaseId: created.activeRelease.id,
        expectedVersion: created.version,
      })
    ).rejects.toMatchObject({
      cause: { code: "organization_skill.edit_forbidden", status: 403 },
    });

    const assigned = await service.setMaintainers(
      fixture.owner,
      created.id,
      [fixture.member.userId],
      created.version
    );
    expect(assigned.maintainerUserIds).toEqual([fixture.member.userId]);
    await expect(
      service.get(fixture.member, created.id)
    ).resolves.toMatchObject({
      permissions: { canEdit: true, canManage: false },
    });

    const updated = await service.update(fixture.member, created.id, {
      bundle: {
        ...created.bundle,
        instructions: "Check the release evidence and rollback plan.",
      },
      expectedActiveReleaseId: created.activeRelease.id,
      expectedVersion: assigned.version,
    });
    expect(updated).toMatchObject({
      bundle: {
        instructions: "Check the release evidence and rollback plan.",
      },
      version: 3,
    });
    expect(updated.activeRelease.id).not.toBe(created.activeRelease.id);
    await expect(
      service.readRuntimeSnapshot(fixture.organizationId, frozenSelection)
    ).resolves.toMatchObject({
      organizationId: fixture.organizationId,
      releases: [
        {
          bundle: { instructions: "Check the release evidence." },
          releaseId: created.activeRelease.id,
          skillId: created.id,
        },
      ],
    });
    const noOpSave = await service.update(fixture.member, created.id, {
      bundle: updated.bundle,
      expectedActiveReleaseId: updated.activeRelease.id,
      expectedVersion: updated.version,
    });
    expect(noOpSave).toMatchObject({
      activeRelease: { id: updated.activeRelease.id },
      version: updated.version,
    });
    expect(noOpSave.releases).toHaveLength(2);

    await env.OPENMELD_DB.prepare("DELETE FROM members WHERE id = ?")
      .bind(fixture.memberMemberId)
      .run();
    await expect(service.get(fixture.owner, created.id)).resolves.toMatchObject(
      {
        maintainerUserIds: [],
      }
    );
    await env.OPENMELD_DB.prepare(
      "INSERT INTO members (id, organization_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)"
    )
      .bind(
        `rejoined_${fixture.memberMemberId}`,
        fixture.organizationId,
        fixture.member.userId,
        fixture.member.role,
        Date.now() + 1000
      )
      .run();
    await expect(
      service.get(fixture.member, created.id)
    ).resolves.toMatchObject({
      maintainerUserIds: [],
      permissions: { canEdit: false, canManage: false },
    });

    await expect(
      service.setEnabled(fixture.member, created.id, false, updated.version)
    ).rejects.toMatchObject({
      cause: { code: "organization_skill.manage_forbidden", status: 403 },
    });
    const disabled = await service.setEnabled(
      fixture.owner,
      created.id,
      false,
      updated.version
    );
    await expect(
      service.readRuntimeSnapshot(fixture.organizationId)
    ).resolves.toEqual({
      organizationId: fixture.organizationId,
      releases: [],
    });

    const reenabled = await service.setEnabled(
      fixture.owner,
      created.id,
      true,
      disabled.version
    );
    await expect(
      service.readRuntimeSnapshot(fixture.organizationId)
    ).resolves.toMatchObject({
      organizationId: fixture.organizationId,
      releases: [
        {
          bundle: {
            instructions: "Check the release evidence and rollback plan.",
          },
          releaseId: updated.activeRelease.id,
          skillId: created.id,
        },
      ],
    });
    await service.remove(fixture.owner, created.id, reenabled.version);
    await expect(
      service.readRuntimeSnapshot(fixture.organizationId)
    ).resolves.toEqual({
      organizationId: fixture.organizationId,
      releases: [],
    });
    await expect(
      service.readRuntimeSnapshot(fixture.organizationId, frozenSelection)
    ).resolves.toMatchObject({
      releases: [
        {
          bundle: { instructions: "Check the release evidence." },
          releaseId: created.activeRelease.id,
        },
      ],
    });
  });

  it("keeps the winning Maintainers when a stale concurrent update is rejected", async () => {
    const fixture = await seedFixture();
    const service = createService();
    const created = await service.create(fixture.owner, {
      description: "Review a release before it ships.",
      instructions: "Check the release evidence.",
      name: "concurrent-maintainers",
    });
    const concurrentDb = {
      batch: async (statements: D1PreparedStatement[]) => {
        await env.OPENMELD_DB.prepare(
          `
            UPDATE organization_skills
            SET updated_at = ?,
                version = version + 1
            WHERE id = ?
              AND organization_id = ?
              AND version = ?
          `
        )
          .bind(Date.now(), created.id, fixture.organizationId, created.version)
          .run();
        await env.OPENMELD_DB.prepare(
          `
            INSERT INTO organization_skill_maintainers (
              assigned_at,
              assigned_by_user_id,
              organization_id,
              skill_id,
              user_id
            )
            VALUES (?, ?, ?, ?, ?)
          `
        )
          .bind(
            Date.now(),
            fixture.owner.userId,
            fixture.organizationId,
            created.id,
            fixture.member.userId
          )
          .run();
        return await env.OPENMELD_DB.batch(statements);
      },
      prepare: env.OPENMELD_DB.prepare.bind(env.OPENMELD_DB),
    } as unknown as D1Database;
    const staleService = createService({ db: concurrentDb });

    await expect(
      staleService.setMaintainers(
        fixture.owner,
        created.id,
        [],
        created.version
      )
    ).rejects.toMatchObject({
      cause: {
        code: "organization_skill.version_conflict",
        status: 409,
      },
    });
    await expect(service.get(fixture.owner, created.id)).resolves.toMatchObject(
      {
        maintainerUserIds: [fixture.member.userId],
        version: created.version + 1,
      }
    );
  });

  it("creates a new release when saved content returns to a historical version", async () => {
    const fixture = await seedFixture();
    const service = createService();
    const original = await service.create(fixture.owner, {
      description: "Review a release before it ships.",
      instructions: "Check the release evidence.",
      name: "historical-release-content",
    });
    const edited = await service.update(fixture.owner, original.id, {
      bundle: {
        ...original.bundle,
        instructions: "Check the release evidence and rollback plan.",
      },
      expectedActiveReleaseId: original.activeRelease.id,
      expectedVersion: original.version,
    });

    const restored = await service.update(fixture.owner, original.id, {
      bundle: original.bundle,
      expectedActiveReleaseId: edited.activeRelease.id,
      expectedVersion: edited.version,
    });

    expect(restored).toMatchObject({
      activeRelease: {
        digest: original.activeRelease.digest,
      },
      bundle: original.bundle,
      version: edited.version + 1,
    });
    expect(restored.activeRelease.id).not.toBe(original.activeRelease.id);
    expect(restored.activeRelease.id).not.toBe(edited.activeRelease.id);
    expect(restored.releases).toHaveLength(3);
  });

  it("fails closed on stale saves and cross-Organization reads", async () => {
    const fixture = await seedFixture();
    const service = createService();
    const created = await service.create(fixture.owner, {
      description: "Triage an incident.",
      instructions: "Read the timeline.",
      name: "incident-triage",
    });
    const updated = await service.update(fixture.owner, created.id, {
      bundle: { ...created.bundle, instructions: "Read the full timeline." },
      expectedActiveReleaseId: created.activeRelease.id,
      expectedVersion: created.version,
    });

    await expect(
      service.update(fixture.owner, created.id, {
        bundle: { ...created.bundle, instructions: "Overwrite newer work." },
        expectedActiveReleaseId: created.activeRelease.id,
        expectedVersion: created.version,
      })
    ).rejects.toMatchObject({
      cause: { code: "organization_skill.version_conflict", status: 409 },
    });
    await expect(service.get(fixture.owner, created.id)).resolves.toMatchObject(
      {
        activeRelease: { id: updated.activeRelease.id },
        bundle: { instructions: "Read the full timeline." },
      }
    );
    await expect(
      service.get(
        {
          ...fixture.owner,
          organizationId: `other_${fixture.organizationId}`,
        },
        created.id
      )
    ).rejects.toMatchObject({
      cause: { code: "organization_skill.not_found", status: 404 },
    });
  });

  it("rejects duplicate names without leaving an uncommitted release object", async () => {
    const fixture = await seedFixture();
    const service = createService();
    await service.create(fixture.owner, {
      description: "Review a release before it ships.",
      instructions: "Check the release evidence.",
      name: "release-review",
    });

    await expect(
      service.create(fixture.owner, {
        description: "A conflicting name.",
        instructions: "This must not be installed.",
        name: "release-review",
      })
    ).rejects.toMatchObject({
      cause: { code: "organization_skill.name_exists", status: 409 },
    });
    const objects = await env.OPENMELD_ORGANIZATION_SKILLS.list({
      prefix: `organizations/${fixture.organizationId}/`,
    });
    expect(objects.objects).toHaveLength(1);
  });

  it("rejects management actions before the enabled runtime catalog exceeds its limits", async () => {
    const fixture = await seedFixture();
    const service = createService();
    let firstSkill: { id: string; version: number } | null = null;
    for (
      let index = 0;
      index < ORGANIZATION_SKILL_RUNTIME_RELEASE_LIMIT;
      index += 1
    ) {
      const created = await service.create(fixture.owner, {
        description: `Catalog Skill ${index}.`,
        instructions: "Use this Skill only when relevant.",
        name: `catalog-skill-${index}`,
      });
      firstSkill ??= created;
    }

    await expect(
      service.create(fixture.owner, {
        description: "One Skill too many.",
        instructions: "This must remain uninstalled.",
        name: "catalog-overflow",
      })
    ).rejects.toMatchObject({
      cause: {
        code: "organization_skill.runtime_release_limit",
        status: 409,
      },
    });

    if (!firstSkill) {
      throw new Error("The catalog limit fixture did not create a Skill.");
    }
    const disabled = await service.setEnabled(
      fixture.owner,
      firstSkill.id,
      false,
      firstSkill.version
    );
    await service.create(fixture.owner, {
      description: "The replacement Skill.",
      instructions: "Use the replacement.",
      name: "catalog-replacement",
    });
    await expect(
      service.setEnabled(fixture.owner, disabled.id, true, disabled.version)
    ).rejects.toMatchObject({
      cause: {
        code: "organization_skill.runtime_release_limit",
        status: 409,
      },
    });
    await expect(
      readEnabledOrganizationSkillReleaseSelection({
        db: env.OPENMELD_DB,
        organizationId: fixture.organizationId,
      })
    ).resolves.toHaveLength(ORGANIZATION_SKILL_RUNTIME_RELEASE_LIMIT);
  });

  it("rejects enabling or installing when the runtime catalog is already too large", async () => {
    const fixture = await seedFixture();
    const service = createService();
    const candidate = await service.create(fixture.owner, {
      description: "A candidate Skill.",
      instructions: "Use the candidate.",
      name: "catalog-candidate",
    });
    const disabled = await service.setEnabled(
      fixture.owner,
      candidate.id,
      false,
      candidate.version
    );
    const blocker = await service.create(fixture.owner, {
      description: "A catalog capacity fixture.",
      instructions: "Reserve the catalog capacity.",
      name: "catalog-capacity",
    });
    await env.OPENMELD_DB.prepare(
      `
        UPDATE organization_skill_releases
        SET manifest_json = json_set(
          manifest_json,
          '$.runtimeBytes',
          ?
        )
        WHERE id = ?
      `
    )
      .bind(
        ORGANIZATION_SKILL_RUNTIME_CATALOG_MAX_BYTES,
        blocker.activeRelease.id
      )
      .run();

    await expect(
      service.setEnabled(fixture.owner, disabled.id, true, disabled.version)
    ).rejects.toMatchObject({
      cause: {
        code: "organization_skill.runtime_catalog_too_large",
        status: 409,
      },
    });
    await expect(
      service.create(fixture.owner, {
        description: "A Skill that cannot fit.",
        instructions: "This must remain uninstalled.",
        name: "catalog-too-large",
      })
    ).rejects.toMatchObject({
      cause: {
        code: "organization_skill.runtime_catalog_too_large",
        status: 409,
      },
    });
  });

  it("rejects saving an enabled Skill when its replacement release would exceed the runtime catalog limit", async () => {
    const fixture = await seedFixture();
    const service = createService();
    const candidate = await service.create(fixture.owner, {
      description: "A candidate Skill.",
      instructions: "Use the candidate.",
      name: "catalog-update-candidate",
    });
    const blocker = await service.create(fixture.owner, {
      description: "A catalog capacity fixture.",
      instructions: "Reserve the remaining catalog capacity.",
      name: "catalog-update-capacity",
    });
    const candidateManifest = await env.OPENMELD_DB.prepare(
      `
        SELECT manifest_json
        FROM organization_skill_releases
        WHERE id = ?
      `
    )
      .bind(candidate.activeRelease.id)
      .first<{ manifest_json: string }>();
    if (!candidateManifest) {
      throw new Error("The candidate release manifest is unavailable.");
    }
    const candidateRuntimeBytes = Number(
      (
        JSON.parse(candidateManifest.manifest_json) as {
          runtimeBytes: number;
        }
      ).runtimeBytes
    );
    await env.OPENMELD_DB.prepare(
      `
        UPDATE organization_skill_releases
        SET manifest_json = json_set(
          manifest_json,
          '$.runtimeBytes',
          ?
        )
        WHERE id = ?
      `
    )
      .bind(
        ORGANIZATION_SKILL_RUNTIME_CATALOG_MAX_BYTES - candidateRuntimeBytes,
        blocker.activeRelease.id
      )
      .run();

    await expect(
      service.update(fixture.owner, candidate.id, {
        bundle: {
          ...candidate.bundle,
          instructions: `${candidate.bundle.instructions} Add more guidance.`,
        },
        expectedActiveReleaseId: candidate.activeRelease.id,
        expectedVersion: candidate.version,
      })
    ).rejects.toMatchObject({
      cause: {
        code: "organization_skill.runtime_catalog_too_large",
        status: 409,
      },
    });
    await expect(
      service.get(fixture.owner, candidate.id)
    ).resolves.toMatchObject({
      activeRelease: { id: candidate.activeRelease.id },
      releases: [{ id: candidate.activeRelease.id }],
      version: candidate.version,
    });
  });

  it("imports one portable Skill from an immutable GitHub commit", async () => {
    const commitSha = "a".repeat(40);
    const fetchMock = vi.fn<typeof fetch>((request) =>
      Promise.resolve(readGitHubFixtureResponse(String(request), commitSha))
    );

    await expect(
      importOrganizationSkillBundleFromGitHub({
        fetch: fetchMock,
        githubToken: "github-test-token",
        url: "https://github.com/acme/skills",
      })
    ).resolves.toMatchObject({
      bundle: {
        files: [
          {
            content: "# Checklist",
            encoding: "utf8",
            path: "references/checklist.md",
            size: 11,
          },
        ],
        instructions: "Follow the release checklist.",
        portable: {
          description: "Review release evidence.",
          license: "MIT",
          name: "release-review",
        },
      },
      source: {
        commitSha,
        kind: "github",
        path: "release",
        repository: "https://github.com/acme/skills",
      },
    });
    expect(
      fetchMock.mock.calls.some(([request]) =>
        String(request).includes(`/${commitSha}/release/SKILL.md`)
      )
    ).toBe(true);
    const authenticatedApiCall = fetchMock.mock.calls.find(([request]) =>
      String(request).startsWith("https://api.github.com/")
    );
    expect(
      new Headers(authenticatedApiCall?.[1]?.headers).get("Authorization")
    ).toBe("Bearer github-test-token");
    await expect(
      importOrganizationSkillBundleFromGitHub({
        expectedCommitSha: "b".repeat(40),
        fetch: fetchMock,
        url: "https://github.com/acme/skills",
      })
    ).rejects.toMatchObject({
      cause: { code: "organization_skill.github_source_changed", status: 400 },
    });
  });

  it("retries public GitHub reads without a repository-scoped token", async () => {
    const commitSha = "e".repeat(40);
    const fetchMock = vi.fn<typeof fetch>((request, init) => {
      const url = String(request);
      const authorization = new Headers(init?.headers).get("Authorization");
      if (url.startsWith("https://api.github.com/") && authorization) {
        return Promise.resolve(new Response("not found", { status: 404 }));
      }
      return Promise.resolve(readGitHubFixtureResponse(url, commitSha));
    });

    await expect(
      importOrganizationSkillBundleFromGitHub({
        fetch: fetchMock,
        githubToken: "repository-scoped-token",
        url: "https://github.com/acme/skills",
      })
    ).resolves.toMatchObject({
      bundle: {
        portable: {
          name: "release-review",
        },
      },
      source: {
        commitSha,
        repository: "https://github.com/acme/skills",
      },
    });
    expect(
      fetchMock.mock.calls.some(
        ([request, init]) =>
          String(request).startsWith("https://api.github.com/") &&
          new Headers(init?.headers).has("Authorization")
      )
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some(
        ([request, init]) =>
          String(request).startsWith("https://api.github.com/") &&
          !new Headers(init?.headers).has("Authorization")
      )
    ).toBe(true);
  });

  it("rejects an oversized GitHub Skill before downloading its blobs", async () => {
    const commitSha = "d".repeat(40);
    const fetchMock = vi.fn<typeof fetch>((request) => {
      const url = String(request);
      if (url.includes(`/git/trees/${commitSha}?recursive=1`)) {
        return Promise.resolve(
          Response.json({
            tree: [
              {
                mode: "100644",
                path: "release/SKILL.md",
                size: ORGANIZATION_SKILL_BUNDLE_MAX_BYTES + 1,
                type: "blob",
              },
            ],
            truncated: false,
          })
        );
      }
      return Promise.resolve(readGitHubFixtureResponse(url, commitSha));
    });

    await expect(
      importOrganizationSkillBundleFromGitHub({
        fetch: fetchMock,
        url: "https://github.com/acme/skills",
      })
    ).rejects.toMatchObject({
      cause: { code: "organization_skill.bundle_too_large", status: 400 },
    });
    expect(
      fetchMock.mock.calls.some(([request]) =>
        String(request).startsWith("https://raw.githubusercontent.com/")
      )
    ).toBe(false);
  });

  it("lets managers preview the exact GitHub release before installation", async () => {
    const fixture = await seedFixture();
    const commitSha = "c".repeat(40);
    const fetchMock = vi.fn<typeof fetch>((request) =>
      Promise.resolve(readGitHubFixtureResponse(String(request), commitSha))
    );
    const service = createService({ fetch: fetchMock });

    await expect(
      service.previewFromGitHub(fixture.owner, "https://github.com/acme/skills")
    ).resolves.toMatchObject({
      files: [
        {
          encoding: "utf8",
          mediaType: "text/markdown",
          path: "references/checklist.md",
          size: 11,
        },
      ],
      instructionsCharacters: 29,
      portable: {
        allowedTools: "Read, Grep",
        name: "release-review",
      },
      source: { commitSha, kind: "github" },
      warnings: [
        "The allowed-tools field is preserved but does not grant OpenMeld permissions.",
      ],
    });
    await expect(
      service.previewFromGitHub(
        fixture.member,
        "https://github.com/acme/skills"
      )
    ).rejects.toMatchObject({
      cause: { code: "organization_skill.manage_forbidden", status: 403 },
    });
  });

  it("lets the represented owner install once through Center Agent while members can only read", async () => {
    const fixture = await seedFixture();
    const context = centerAgentRequestContext(fixture);
    const ownerSpeaker = {
      memberId: fixture.ownerMemberId,
      userId: fixture.owner.userId,
    };
    const request = {
      action: "create" as const,
      bundle: {
        files: [],
        instructions: "Review the release evidence.",
        portable: {
          allowedTools: null,
          compatibility: null,
          description: "Review a release before it ships.",
          license: null,
          metadata: {},
          name: "release-review",
        },
      },
      context,
      operationId: "install-release-review",
      speakerMember: ownerSpeaker,
    };

    const installed = await rpcCenterAgentInstallOrganizationSkill(
      coreEnv(),
      request
    );
    const replayed = await rpcCenterAgentInstallOrganizationSkill(
      coreEnv(),
      request
    );
    expect(replayed).toEqual(installed);
    await env.OPENMELD_DB.prepare(
      `
        UPDATE center_agent_organization_skill_operations
        SET completed_at = NULL, response_json = NULL, created_at = 0
        WHERE organization_id = ?
      `
    )
      .bind(fixture.organizationId)
      .run();
    await expect(
      rpcCenterAgentInstallOrganizationSkill(coreEnv(), request)
    ).resolves.toEqual(installed);
    await expect(
      rpcCenterAgentInstallOrganizationSkill(coreEnv(), {
        ...request,
        bundle: {
          ...request.bundle,
          instructions: "A different request.",
        },
      })
    ).rejects.toMatchObject({
      cause: { code: "organization_skill.operation_conflict", status: 409 },
    });

    const listed = await rpcCenterAgentReadOrganizationSkills(coreEnv(), {
      action: "list",
      context,
      speakerMember: {
        memberId: fixture.memberMemberId,
        userId: fixture.member.userId,
      },
    });
    expect(listed).toMatchObject({
      action: "list",
      canManage: false,
      organizationId: fixture.organizationId,
      skills: [{ id: installed.skill.id, name: "release-review" }],
    });
    await expect(
      rpcCenterAgentInstallOrganizationSkill(coreEnv(), {
        ...request,
        operationId: "member-install",
        speakerMember: {
          memberId: fixture.memberMemberId,
          userId: fixture.member.userId,
        },
      })
    ).rejects.toMatchObject({
      cause: { code: "organization_skill.manage_forbidden", status: 403 },
    });

    const counts = await env.OPENMELD_DB.prepare(
      `
        SELECT
          (SELECT COUNT(*) FROM organization_skills WHERE organization_id = ?) AS skills,
          (SELECT COUNT(*) FROM center_agent_organization_skill_operations WHERE organization_id = ?) AS operations
      `
    )
      .bind(fixture.organizationId, fixture.organizationId)
      .first<{ operations: number; skills: number }>();
    expect(counts).toEqual({ operations: 1, skills: 1 });
    const audits = await env.OPENMELD_DB.prepare(
      `
        SELECT action, on_behalf_of_user_id
        FROM center_agent_audit_journal
        WHERE organization_id = ?
        ORDER BY created_at ASC
      `
    )
      .bind(fixture.organizationId)
      .all<{ action: string; on_behalf_of_user_id: string | null }>();
    expect(audits.results).toEqual([
      {
        action: "install_org_skill",
        on_behalf_of_user_id: fixture.owner.userId,
      },
      {
        action: "read_org_skills",
        on_behalf_of_user_id: fixture.member.userId,
      },
    ]);
  });

  it("does not turn a repeated install into success or delete a committed release after an edit", async () => {
    const fixture = await seedFixture();
    const request = {
      action: "create" as const,
      bundle: {
        files: [],
        instructions: "Review the release evidence.",
        portable: {
          allowedTools: null,
          compatibility: null,
          description: "Review a release before it ships.",
          license: null,
          metadata: {},
          name: "release-review",
        },
      },
      context: centerAgentRequestContext(fixture),
      operationId: "first-install",
      speakerMember: {
        memberId: fixture.ownerMemberId,
        userId: fixture.owner.userId,
      },
    };
    const installed = await rpcCenterAgentInstallOrganizationSkill(
      coreEnv(),
      request
    );
    const service = createService();
    const original = await service.get(fixture.owner, installed.skill.id);
    const edited = await service.update(fixture.owner, original.id, {
      bundle: {
        ...original.bundle,
        instructions: "Review the evidence and the rollback plan.",
      },
      expectedActiveReleaseId: original.activeRelease.id,
      expectedVersion: original.version,
    });
    const originalObjectKey = `organizations/${fixture.organizationId}/skills/${original.id}/releases/${original.activeRelease.id}.json`;

    await expect(
      rpcCenterAgentInstallOrganizationSkill(coreEnv(), {
        ...request,
        operationId: "second-install",
      })
    ).rejects.toMatchObject({
      cause: { code: "organization_skill.name_exists", status: 409 },
    });

    expect(
      await env.OPENMELD_ORGANIZATION_SKILLS.get(originalObjectKey)
    ).not.toBeNull();
    await expect(
      service.get(fixture.owner, original.id)
    ).resolves.toMatchObject({
      activeRelease: { id: edited.activeRelease.id },
      releases: [
        { id: edited.activeRelease.id },
        { id: original.activeRelease.id },
      ],
    });
  });
});

function readGitHubFixtureResponse(url: string, commitSha: string): Response {
  if (url === "https://api.github.com/repos/acme/skills") {
    return Response.json({ default_branch: "main" });
  }
  if (url.endsWith("/repos/acme/skills/commits/main")) {
    return Response.json({ sha: commitSha });
  }
  if (url.includes(`/git/trees/${commitSha}?recursive=1`)) {
    return Response.json({
      tree: [
        {
          mode: "100644",
          path: "release/SKILL.md",
          size: 161,
          type: "blob",
        },
        {
          mode: "100644",
          path: "release/references/checklist.md",
          size: 11,
          type: "blob",
        },
      ],
      truncated: false,
    });
  }
  if (url.endsWith(`/${commitSha}/release/SKILL.md`)) {
    return new Response(
      [
        "---",
        "name: release-review",
        "description: Review release evidence.",
        "license: MIT",
        "allowed-tools: Read, Grep",
        "---",
        "Follow the release checklist.",
      ].join("\n")
    );
  }
  if (url.endsWith(`/${commitSha}/release/references/checklist.md`)) {
    return new Response("# Checklist");
  }
  return new Response("not found", { status: 404 });
}

function createService(input: { db?: D1Database; fetch?: typeof fetch } = {}) {
  return createOrganizationSkillService({
    bucket: env.OPENMELD_ORGANIZATION_SKILLS,
    db: input.db ?? env.OPENMELD_DB,
    fetch: input.fetch,
  });
}

function coreEnv(): CoreBindings {
  return {
    OPENMELD_DB: env.OPENMELD_DB,
    OPENMELD_ORGANIZATION_SKILLS: env.OPENMELD_ORGANIZATION_SKILLS,
  } as CoreBindings;
}

function centerAgentRequestContext(
  fixture: Awaited<ReturnType<typeof seedFixture>>
) {
  return {
    activeOrganizationId: fixture.organizationId,
    actorContext: {
      agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
      callerPrincipalId: fixture.centerAgentProfileId,
      profileKind: "agent" as const,
      profileName: "Center Agent",
      requestId: `skill-request-${crypto.randomUUID()}`,
      openMeldProfileId: fixture.centerAgentProfileId,
    },
  };
}

async function seedFixture(): Promise<{
  centerAgentProfileId: string;
  member: OrganizationSkillActor;
  memberMemberId: string;
  organizationId: string;
  owner: OrganizationSkillActor;
  ownerMemberId: string;
}> {
  const suffix = crypto.randomUUID();
  const organizationId = `org_skills_${suffix}`;
  const users = [
    { id: `skill_owner_${suffix}`, name: "Olivia Owner", role: "owner" },
    { id: `skill_member_${suffix}`, name: "Morgan Member", role: "member" },
  ] as const;
  await env.OPENMELD_DB.prepare(
    "INSERT INTO organizations (id, name, slug, created_at) VALUES (?, ?, ?, ?)"
  )
    .bind(organizationId, "Skills Org", `skills-${suffix}`, 1000)
    .run();
  for (const [index, user] of users.entries()) {
    await env.OPENMELD_DB.prepare(
      "INSERT INTO users (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    )
      .bind(
        user.id,
        user.name,
        `skills-${index}-${suffix}@example.com`,
        1,
        1000,
        1000
      )
      .run();
    await env.OPENMELD_DB.prepare(
      "INSERT INTO members (id, organization_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)"
    )
      .bind(
        `skill_membership_${index}_${suffix}`,
        organizationId,
        user.id,
        user.role,
        1000
      )
      .run();
    await env.OPENMELD_DB.prepare(
      `
        INSERT INTO openmeld_profiles (
          profile_id,
          profile_name,
          profile_handle,
          profile_kind,
          is_default,
          status,
          owner_user_id,
          created_by_user_id,
          source,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, 'human', 1, 'active', ?, ?, 'auth_bootstrap', ?, ?)
      `
    )
      .bind(
        crypto.randomUUID(),
        user.name,
        `skill-human-${index}-${suffix}`,
        user.id,
        user.id,
        1000,
        1000
      )
      .run();
  }
  const centerAgentProfileId = `agt_${crypto.randomUUID()}`;
  await env.OPENMELD_DB.prepare(
    `
      INSERT INTO openmeld_profiles (
        profile_id,
        profile_name,
        profile_handle,
        profile_kind,
        is_default,
        status,
        organization_id,
        owner_user_id,
        created_by_user_id,
        source,
        managed_role,
        created_at,
        updated_at
      ) VALUES (?, 'Center Agent', ?, 'agent', 0, 'active', ?, NULL, ?, 'cli_create', 'center_agent', ?, ?)
    `
  )
    .bind(
      centerAgentProfileId,
      `skill-center-${suffix}`,
      organizationId,
      users[0].id,
      1000,
      1000
    )
    .run();
  await env.OPENMELD_DB.prepare(
    `
      INSERT INTO center_agent_designations (
        organization_id,
        agent_profile_id,
        duty,
        designated_by,
        created_at
      ) VALUES (?, ?, NULL, ?, ?)
    `
  )
    .bind(organizationId, centerAgentProfileId, users[0].id, 1000)
    .run();
  return {
    centerAgentProfileId,
    member: {
      organizationId,
      role: users[1].role,
      userId: users[1].id,
    },
    memberMemberId: `skill_membership_1_${suffix}`,
    organizationId,
    owner: {
      organizationId,
      role: users[0].role,
      userId: users[0].id,
    },
    ownerMemberId: `skill_membership_0_${suffix}`,
  };
}
