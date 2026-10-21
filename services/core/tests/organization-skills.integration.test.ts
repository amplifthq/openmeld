import { SELF } from "cloudflare:test";
import {
  getPostgresDatabase,
  type PostgresDatabase,
} from "@openmeld/db/postgresql";
import {
  applyOpenMeldRequestContextHeaders,
  OPENMELD_EXPECTED_FORWARDED_BY,
} from "@openmeld/gateway-contract";
import {
  HOSTED_CENTER_AGENT_CONTROLLER_REF,
  ORGANIZATION_SKILL_BUNDLE_MAX_BYTES,
  ORGANIZATION_SKILL_FILE_MAX_BYTES,
  ORGANIZATION_SKILL_RUNTIME_CATALOG_MAX_BYTES,
  ORGANIZATION_SKILL_RUNTIME_RELEASE_LIMIT,
  organizationSkillGitHubRepositoryPreviewSchema,
  stringifyOrganizationSkillBundleCanonicalJson,
} from "@openmeld/schemas";
import type { OpenMeldRequestContext } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import {
  rpcCenterAgentInstallOrganizationSkill,
  rpcCenterAgentReadOrganizationSkills,
} from "../src/organization-skills/center-agent-organization-skill-rpc";
import {
  importOrganizationSkillBundleFromGitHub,
  previewOrganizationSkillRepositoryFromGitHub,
} from "../src/organization-skills/organization-skill-import";
import {
  rpcBeginOrganizationSkillImportBatch,
  rpcGetOrganizationSkill,
  rpcGetOrganizationSkillImportBatch,
  rpcImportOrganizationSkillFromGitHub,
  rpcListOrganizationSkillImportBatches,
  rpcListOrganizationSkills,
} from "../src/organization-skills/organization-skill-rpc";
import {
  createOrganizationSkillService,
  type OrganizationSkillActor,
  readEnabledOrganizationSkillReleaseSelection,
} from "../src/organization-skills/organization-skill-service";
import { observePostgresDatabase } from "../test-support/postgresql-query.test-support";
import { env } from "../test-support/worker-env";

const GITHUB_SKILL_MARKDOWN = [
  "---",
  "name: release-review",
  "description: Review release evidence.",
  "license: MIT",
  "allowed-tools: Read, Grep",
  "---",
  "Follow the release checklist.",
].join("\n");
describe("Organization Skills", () => {
  it("keeps an ordinary Agent's selected release after an update and rejects it after disablement", async () => {
    const fixture = await seedFixture();
    const profileId = `agt_${crypto.randomUUID()}`;
    await getPostgresDatabase(env).query({
      text: "INSERT INTO \"openmeld\".\"openmeld_profiles\"\n      (profile_id, profile_name, profile_handle, profile_kind, is_default, status, organization_id, owner_user_id, created_by_user_id, source, created_at, updated_at)\n      VALUES ($1, 'Task reader', $2, 'agent', 0, 'active', $3, $4, $5, 'cli_create', 1000, 1000)",
      values: [
        profileId,
        profileId,
        fixture.organizationId,
        fixture.owner.userId,
        fixture.owner.userId,
      ],
    });
    const context: OpenMeldRequestContext = {
      activeOrganizationId: fixture.organizationId,
      actorContext: {
        requestId: crypto.randomUUID(),
        callerPrincipalId: fixture.owner.userId,
        ownerUserId: fixture.owner.userId,
        openMeldProfileId: profileId,
        profileKind: "agent",
        profileName: "Task reader",
      },
    };
    const coreEnv = env as unknown as CoreBindings;
    const service = createService();
    const initial = await service.create(fixture.owner, {
      name: "holdout-triage",
      description: "Classify a new incident.",
      instructions:
        "If the customer cannot sign in, classify as access. Otherwise classify as service.",
    });
    const list = await rpcListOrganizationSkills(coreEnv, { context });
    expect(list.skills.find((skill) => skill.id === initial.id)).toMatchObject({
      permissions: { canEdit: false, canManage: false },
    });
    const updated = await service.update(fixture.owner, initial.id, {
      bundle: {
        ...initial.bundle,
        instructions: "A later, different workflow.",
      },
      expectedActiveReleaseId: initial.activeRelease.id,
      expectedVersion: initial.version,
    });
    const read = await rpcGetOrganizationSkill(coreEnv, {
      context,
      skillId: initial.id,
      releaseId: initial.activeRelease.id,
    });
    expect(read.selectedRelease?.bundle.instructions).toBe(
      initial.bundle.instructions
    );
    expect(read.selectedRelease?.releaseId).not.toBe(updated.activeRelease.id);
    await service.setEnabled(fixture.owner, initial.id, false, updated.version);
    await expect(
      rpcGetOrganizationSkill(coreEnv, {
        context,
        skillId: initial.id,
        releaseId: initial.activeRelease.id,
      })
    ).rejects.toMatchObject({ status: 403 });
    expect(
      (await rpcListOrganizationSkills(coreEnv, { context })).skills.some(
        (skill) => skill.id === initial.id
      )
    ).toBe(false);
  });
  it("serves one exact resource to a current member and denies it after revocation", async () => {
    const fixture = await seedFixture();
    const service = createService();
    const created = await service.create(fixture.owner, {
      description: "Review a release before it ships.",
      instructions: "Read the reference.",
      name: "resource-access",
    });
    const updated = await service.update(fixture.owner, created.id, {
      bundle: {
        ...created.bundle,
        files: [
          {
            content: "Exact release resource",
            encoding: "utf8",
            mediaType: "text/plain",
            path: "references/note.txt",
            size: new TextEncoder().encode("Exact release resource").byteLength,
          },
        ],
      },
      expectedActiveReleaseId: created.activeRelease.id,
      expectedVersion: created.version,
    });
    const profile = await getPostgresDatabase(env)
      .query<{
        profile_id: string;
      }>({
        ...{
          text: 'SELECT profile_id FROM "openmeld"."openmeld_profiles" WHERE owner_user_id = $1 AND profile_kind = \'human\' LIMIT 1',
          values: [],
        },
        values: [fixture.owner.userId],
      })
      .then((result) => result.rows[0] ?? null);
    if (!profile) {
      throw new Error("Human profile fixture is missing.");
    }
    const context: OpenMeldRequestContext = {
      activeOrganizationId: fixture.organizationId,
      actorContext: {
        requestId: crypto.randomUUID(),
        callerPrincipalId: fixture.owner.userId,
        ownerUserId: fixture.owner.userId,
        openMeldProfileId: profile.profile_id,
        profileKind: "human",
        profileName: "Olivia Owner",
      },
    };
    const headers = applyOpenMeldRequestContextHeaders(
      new Headers(),
      { requestContext: context },
      OPENMELD_EXPECTED_FORWARDED_BY
    );
    const resourceBase = `http://localhost/v1/organizations/current/skills/${created.id}/releases/${updated.activeRelease.id}/resources`;
    const url = `${resourceBase}?path=references%2Fnote.txt`;
    const first = await SELF.fetch(url, { headers });
    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toBe("application/octet-stream");
    expect(first.headers.get("cache-control")).toBe("private, no-store");
    expect(new TextDecoder().decode(await first.arrayBuffer())).toBe(
      "Exact release resource"
    );
    const missing = await SELF.fetch(`${resourceBase}?path=missing.txt`, {
      headers,
    });
    expect(missing.status).toBe(404);
    await getPostgresDatabase(env).query({
      ...{
        text: 'DELETE FROM "openmeld"."members" WHERE id = $1',
        values: [],
      },
      values: [fixture.ownerMemberId],
    });
    const revoked = await SELF.fetch(url, { headers });
    expect(revoked.status).toBe(403);
  });
  it("keeps new writes inline while the file-backed writer is disabled", async () => {
    const fixture = await seedFixture();
    const service = createService({ fileBackedWritesEnabled: false });
    const created = await service.create(fixture.owner, {
      description: "A rollout-compatible Skill.",
      instructions: "Read the reference when needed.",
      name: "rollout-compatible",
    });
    const content = "Read me only when needed.";
    const updated = await service.update(fixture.owner, created.id, {
      bundle: {
        ...created.bundle,
        files: [
          {
            content,
            encoding: "utf8",
            mediaType: "text/plain",
            path: "references/note.txt",
            size: content.length,
          },
        ],
      },
      expectedActiveReleaseId: created.activeRelease.id,
      expectedVersion: created.version,
    });
    const row = await getPostgresDatabase(env)
      .query<{
        object_key: string;
        manifest_json: string;
      }>({
        ...{
          text: 'SELECT object_key, manifest_json FROM "openmeld"."organization_skill_releases" WHERE id = $1',
          values: [],
        },
        values: [updated.activeRelease.id],
      })
      .then((result) => result.rows[0] ?? null);
    if (!row) {
      throw new Error("Release row is missing.");
    }
    const object = await env.OPENMELD_ORGANIZATION_SKILLS.get(row.object_key);
    const saved = JSON.parse((await object?.text()) ?? "null") as {
      files?: Array<{
        content: string;
      }>;
      format?: string;
    };
    expect(saved.format).toBeUndefined();
    expect(saved.files?.[0]?.content).toBe(content);
    expect(JSON.parse(row.manifest_json)).not.toHaveProperty(
      "contentManifestDigest"
    );
    expect(
      await service.readRuntimeResource(
        fixture.owner.organizationId,
        {
          digest: updated.activeRelease.digest,
          name: updated.name,
          releaseId: updated.activeRelease.id,
          skillId: updated.id,
        },
        "references/note.txt"
      )
    ).toMatchObject({ content });
  });
  it("budgets enabled Skills by catalog metadata rather than resource bytes", async () => {
    const fixture = await seedFixture();
    const service = createService();
    const created = await service.create(fixture.owner, {
      description: "Read a supporting reference on demand.",
      instructions: "Read the reference only when needed.",
      name: "catalog-resource-budget",
    });
    const content = "x".repeat(100_000);
    const updated = await service.update(fixture.owner, created.id, {
      bundle: {
        ...created.bundle,
        files: [
          {
            content,
            encoding: "utf8",
            mediaType: "text/plain",
            path: "references/large.txt",
            size: content.length,
          },
        ],
      },
      expectedActiveReleaseId: created.activeRelease.id,
      expectedVersion: created.version,
    });
    const row = await getPostgresDatabase(env)
      .query<{
        manifest_json: string;
      }>({
        ...{
          text: 'SELECT manifest_json FROM "openmeld"."organization_skill_releases" WHERE id = $1',
          values: [],
        },
        values: [updated.activeRelease.id],
      })
      .then((result) => result.rows[0] ?? null);
    const runtimeBytes = Number(
      (
        JSON.parse(row?.manifest_json ?? "null") as {
          runtimeBytes?: number;
        }
      )?.runtimeBytes
    );
    expect(runtimeBytes).toBeGreaterThan(0);
    expect(runtimeBytes).toBeLessThan(2000);
    expect(
      await service.readRuntimeResource(
        fixture.owner.organizationId,
        {
          digest: updated.activeRelease.digest,
          name: updated.name,
          releaseId: updated.activeRelease.id,
          skillId: updated.id,
        },
        "references/large.txt"
      )
    ).toMatchObject({ content, size: content.length });
  });
  it("publishes a resource-heavy portable package and reads one exact resource", async () => {
    const fixture = await seedFixture();
    const service = createService();
    const markdown =
      "---\nname: resource-heavy\ndescription: Read the supporting files when needed.\n---\nUse the references.";
    const largeContent = "x".repeat(1_203_094);
    const smallContent = "y".repeat(30_000);
    const files = [
      {
        content: markdown,
        encoding: "utf8" as const,
        mediaType: "text/markdown",
        path: "SKILL.md",
        size: markdown.length,
      },
      {
        content: largeContent,
        encoding: "utf8" as const,
        mediaType: "text/css",
        path: "references/fonts.css",
        size: largeContent.length,
      },
      ...Array.from({ length: 167 }, (_, index) => ({
        content: smallContent,
        encoding: "utf8" as const,
        mediaType: "text/plain",
        path: `references/part-${index}.txt`,
        size: smallContent.length,
      })),
    ];
    const installed = await service.importFromFiles(fixture.owner, files);
    expect(installed.bundle.files).toHaveLength(168);
    const resource = await service.readRuntimeResource(
      fixture.organizationId,
      {
        digest: installed.activeRelease.digest,
        name: installed.name,
        releaseId: installed.activeRelease.id,
        skillId: installed.id,
      },
      "references/fonts.css"
    );
    expect(resource).toMatchObject({
      content: largeContent,
      size: largeContent.length,
    });
  });
  it("reads a stored UTF-8 resource without dropping its BOM", async () => {
    const fixture = await seedFixture();
    const service = createService();
    const created = await service.create(fixture.owner, {
      description: "Read a schema file.",
      instructions: "Use the schema.",
      name: "bom-resource",
    });
    const content = "\uFEFF<schema/>";
    const file = {
      content,
      encoding: "utf8" as const,
      mediaType: "application/xml",
      path: "references/schema.xml",
      size: new TextEncoder().encode(content).byteLength,
    };
    const updated = await service.update(fixture.owner, created.id, {
      bundle: { ...created.bundle, files: [file] },
      expectedActiveReleaseId: created.activeRelease.id,
      expectedVersion: created.version,
    });
    expect(await service.get(fixture.owner, created.id)).toMatchObject({
      bundle: { files: [file] },
    });
    expect(
      await service.readRuntimeResource(
        fixture.owner.organizationId,
        {
          digest: updated.activeRelease.digest,
          name: updated.name,
          releaseId: updated.activeRelease.id,
          skillId: updated.id,
        },
        file.path
      )
    ).toMatchObject(file);
  });
  it("keeps release resources separate and fails closed when one is missing", async () => {
    const fixture = await seedFixture();
    const service = createService();
    const created = await service.create(fixture.owner, {
      description: "Review a release before it ships.",
      instructions: "Read the checklist.",
      name: "file-backed-review",
    });
    const updated = await service.update(fixture.owner, created.id, {
      bundle: {
        ...created.bundle,
        files: [
          {
            content: "# Checklist",
            encoding: "utf8",
            mediaType: "text/markdown",
            path: "references/checklist.md",
            size: 11,
          },
          {
            content: "AAE=",
            encoding: "base64",
            mediaType: "application/octet-stream",
            path: "assets/template.bin",
            size: 2,
          },
        ],
      },
      expectedActiveReleaseId: created.activeRelease.id,
      expectedVersion: created.version,
    });
    const row = await getPostgresDatabase(env)
      .query<{
        object_key: string;
      }>({
        ...{
          text: 'SELECT object_key FROM "openmeld"."organization_skill_releases" WHERE id = $1',
          values: [],
        },
        values: [updated.activeRelease.id],
      })
      .then((result) => result.rows[0] ?? null);
    if (!row) {
      throw new Error("Release row is missing.");
    }
    const manifest = await env.OPENMELD_ORGANIZATION_SKILLS.get(row.object_key);
    expect(manifest).not.toBeNull();
    const serialized = await manifest?.text();
    const stored = JSON.parse(serialized ?? "null") as {
      files: Array<{
        path: string;
      }>;
      format: string;
    };
    expect(stored?.format).toBe("files-v1");
    expect(stored?.files.map((file) => file.path)).toEqual([
      "references/checklist.md",
      "assets/template.bin",
    ]);
    expect(await service.get(fixture.owner, created.id)).toMatchObject({
      bundle: updated.bundle,
    });
    const selected = {
      digest: updated.activeRelease.digest,
      name: updated.name,
      releaseId: updated.activeRelease.id,
      skillId: updated.id,
    };
    const checklist = updated.bundle.files[0];
    if (!checklist) {
      throw new Error("Checklist resource is missing from the saved release.");
    }
    await env.OPENMELD_ORGANIZATION_SKILLS.delete(
      `${row.object_key}/files/${encodeURIComponent("assets/template.bin")}`
    );
    expect(await service.getCatalog(fixture.owner, updated.id)).toMatchObject({
      releases: [
        {
          files: [
            { path: "references/checklist.md" },
            { path: "assets/template.bin" },
          ],
          instructions: updated.bundle.instructions,
        },
      ],
    });
    expect(
      await service.readRuntimeCatalog(fixture.owner.organizationId, [selected])
    ).toMatchObject({
      releases: [
        {
          files: [
            { path: "references/checklist.md" },
            { path: "assets/template.bin" },
          ],
          instructions: updated.bundle.instructions,
        },
      ],
    });
    expect(
      await service.readRuntimeResource(
        fixture.owner.organizationId,
        selected,
        "references/checklist.md"
      )
    ).toMatchObject(checklist);
    expect(
      await service.getResourceContent(
        fixture.owner,
        updated.id,
        updated.activeRelease.id,
        "references/checklist.md"
      )
    ).toMatchObject({
      bytes: new TextEncoder().encode("# Checklist"),
      mediaType: "text/markdown",
    });
    await expect(
      service.getResourceContent(
        fixture.owner,
        updated.id,
        updated.activeRelease.id,
        "missing.txt"
      )
    ).rejects.toMatchObject({
      cause: { code: "organization_skill.resource_missing", status: 404 },
    });
    await expect(
      service.readRuntimeResource(
        fixture.owner.organizationId,
        selected,
        "assets/template.bin"
      )
    ).rejects.toMatchObject({
      cause: { code: "organization_skill.release_object_missing", status: 503 },
    });
    await env.OPENMELD_ORGANIZATION_SKILLS.put(
      `${row.object_key}/files/${encodeURIComponent("assets/template.bin")}`,
      Uint8Array.of(0, 1)
    );
    await env.OPENMELD_ORGANIZATION_SKILLS.put(
      row.object_key,
      JSON.stringify({ ...stored, instructions: "Tampered instructions" })
    );
    await expect(
      service.readRuntimeResource(
        fixture.owner.organizationId,
        selected,
        "references/checklist.md"
      )
    ).rejects.toMatchObject({
      cause: {
        code: "organization_skill.release_digest_mismatch",
        status: 503,
      },
    });
    await expect(
      service.readRuntimeCatalog(fixture.owner.organizationId, [selected])
    ).rejects.toMatchObject({
      cause: {
        code: "organization_skill.release_digest_mismatch",
        status: 503,
      },
    });
    await env.OPENMELD_ORGANIZATION_SKILLS.put(
      row.object_key,
      serialized ?? ""
    );
    await env.OPENMELD_ORGANIZATION_SKILLS.delete(
      `${row.object_key}/files/${encodeURIComponent("references/checklist.md")}`
    );
    await expect(service.get(fixture.owner, created.id)).rejects.toMatchObject({
      cause: { code: "organization_skill.release_object_missing", status: 503 },
    });
  });
  it("keeps a successful release intact when another writer fails after sharing its resource", async () => {
    const fixture = await seedFixture();
    const created = await createService().create(fixture.owner, {
      description: "Review release evidence.",
      instructions: "Read the checklist.",
      name: "shared-resource-race",
    });
    const bundle = {
      ...created.bundle,
      files: [
        {
          content: "alpha",
          encoding: "utf8" as const,
          mediaType: "text/plain",
          path: "a.txt",
          size: 5,
        },
        {
          content: "beta",
          encoding: "utf8" as const,
          mediaType: "text/plain",
          path: "b.txt",
          size: 4,
        },
      ],
    };
    let signalFirstWrite: () => void = () => undefined;
    let releaseSecondWrite: () => void = () => undefined;
    const firstWrite = new Promise<void>((resolve) => {
      signalFirstWrite = resolve;
    });
    const secondWrite = new Promise<void>((resolve) => {
      releaseSecondWrite = resolve;
    });
    const bucket = new Proxy(env.OPENMELD_ORGANIZATION_SKILLS, {
      get(target, property, receiver) {
        if (property === "put") {
          return async (...args: Parameters<R2Bucket["put"]>) => {
            if (String(args[0]).endsWith("/files/b.txt")) {
              await secondWrite;
              throw new Error("simulated resource write failure");
            }
            const result = await target.put(...args);
            if (String(args[0]).endsWith("/files/a.txt")) {
              signalFirstWrite();
            }
            return result;
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const sharedId = () => "shared-release-race";
    const failedWriter = createOrganizationSkillService({
      bucket,
      db: getPostgresDatabase(env),
      newId: sharedId,
    });
    const winningWriter = createOrganizationSkillService({
      bucket: env.OPENMELD_ORGANIZATION_SKILLS,
      db: getPostgresDatabase(env),
      newId: sharedId,
    });
    const update = {
      bundle,
      expectedActiveReleaseId: created.activeRelease.id,
      expectedVersion: created.version,
    };
    const failed = failedWriter.update(fixture.owner, created.id, update);
    await firstWrite;
    const winner = await winningWriter.update(
      fixture.owner,
      created.id,
      update
    );
    releaseSecondWrite();
    await expect(failed).rejects.toThrow("simulated resource write failure");
    expect(
      (await winningWriter.get(fixture.owner, created.id)).bundle.files
    ).toEqual(bundle.files);
    const objectKey = `organizations/${fixture.organizationId}/skills/${created.id}/releases/${winner.activeRelease.id}.json`;
    expect(
      await env.OPENMELD_ORGANIZATION_SKILLS.get(`${objectKey}/files/a.txt`)
    ).not.toBeNull();
  });
  it("still reads a legacy inline release", async () => {
    const fixture = await seedFixture();
    const service = createService();
    const created = await service.create(fixture.owner, {
      description: "Review a release before it ships.",
      instructions: "Check the release evidence.",
      name: "legacy-review",
    });
    const saved = await service.update(fixture.owner, created.id, {
      bundle: {
        ...created.bundle,
        files: [
          {
            content: "# Historical checklist",
            encoding: "utf8",
            mediaType: "text/markdown",
            path: "references/checklist.md",
            size: 22,
          },
        ],
      },
      expectedActiveReleaseId: created.activeRelease.id,
      expectedVersion: created.version,
    });
    const row = await getPostgresDatabase(env)
      .query<{
        object_key: string;
      }>({
        ...{
          text: 'SELECT object_key FROM "openmeld"."organization_skill_releases" WHERE id = $1',
          values: [],
        },
        values: [saved.activeRelease.id],
      })
      .then((result) => result.rows[0] ?? null);
    if (!row) {
      throw new Error("Release row is missing.");
    }
    await env.OPENMELD_ORGANIZATION_SKILLS.put(
      row.object_key,
      stringifyOrganizationSkillBundleCanonicalJson(saved.bundle),
      { customMetadata: { digest: saved.activeRelease.digest } }
    );
    await expect(service.get(fixture.owner, created.id)).resolves.toMatchObject(
      {
        bundle: saved.bundle,
      }
    );
  });
  it("keeps management with owners and admins while assigned maintainers can edit", async () => {
    const fixture = await seedFixture();
    const service = createService();
    const created = await service.create(fixture.owner, {
      description: "Review a release before it ships.",
      instructions: "Check the release evidence.",
      name: "release-review",
    });
    const frozenSelection = await readEnabledOrganizationSkillReleaseSelection({
      db: getPostgresDatabase(env),
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
      service.getEnabledRelease(
        fixture.member,
        created.id,
        created.activeRelease.id
      )
    ).resolves.toMatchObject({
      bundle: { instructions: "Check the release evidence." },
      releaseId: created.activeRelease.id,
      digest: created.activeRelease.digest,
    });
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
    await getPostgresDatabase(env).query({
      ...{
        text: 'DELETE FROM "openmeld"."members" WHERE id = $1',
        values: [],
      },
      values: [fixture.memberMemberId],
    });
    await expect(service.get(fixture.owner, created.id)).resolves.toMatchObject(
      {
        maintainerUserIds: [],
      }
    );
    await getPostgresDatabase(env).query({
      ...{
        text: 'INSERT INTO "openmeld"."members" (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, $4, $5)',
        values: [],
      },
      values: [
        `rejoined_${fixture.memberMemberId}`,
        fixture.organizationId,
        fixture.member.userId,
        fixture.member.role,
        Date.now() + 1000,
      ],
    });
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
      service.getEnabledRelease(
        fixture.owner,
        created.id,
        created.activeRelease.id
      )
    ).rejects.toMatchObject({
      cause: { code: "organization_skill.disabled", status: 403 },
    });
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
  it("drops only disabled optional releases while explicit selections still fail", async () => {
    const fixture = await seedFixture();
    const service = createService();
    const kept = await service.create(fixture.owner, {
      description: "Still enabled.",
      instructions: "Use this Skill when helpful.",
      name: "optional-kept",
    });
    const removed = await service.create(fixture.owner, {
      description: "Disabled before this turn starts.",
      instructions: "This Skill should not be mounted.",
      name: "optional-disabled",
    });
    const selectedReleases = await readEnabledOrganizationSkillReleaseSelection(
      {
        db: getPostgresDatabase(env),
        organizationId: fixture.organizationId,
      }
    );
    await service.setEnabled(fixture.owner, removed.id, false, removed.version);
    await expect(
      readEnabledOrganizationSkillReleaseSelection({
        db: getPostgresDatabase(env),
        organizationId: fixture.organizationId,
        selectedReleases,
      })
    ).rejects.toMatchObject({
      cause: { code: "organization_skill.release_unavailable", status: 403 },
    });
    await expect(
      readEnabledOrganizationSkillReleaseSelection({
        db: getPostgresDatabase(env),
        organizationId: fixture.organizationId,
        selectedReleases,
        skipUnavailableSelectedReleases: true,
      })
    ).resolves.toEqual(
      selectedReleases.filter((release) => release.skillId === kept.id)
    );
    await expect(
      readEnabledOrganizationSkillReleaseSelection({
        db: getPostgresDatabase(env),
        organizationId: fixture.organizationId,
        selectedReleases: selectedReleases.map((release) =>
          release.skillId === kept.id
            ? { ...release, digest: "f".repeat(64) }
            : release
        ),
        skipUnavailableSelectedReleases: true,
      })
    ).rejects.toMatchObject({
      cause: { code: "organization_skill.release_unavailable", status: 403 },
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
    let interleaved = false;
    const concurrentDb = observePostgresDatabase(
      getPostgresDatabase(env),
      () => undefined,
      async () => {
        if (interleaved) {
          return;
        }
        interleaved = true;
        await service.setMaintainers(
          fixture.owner,
          created.id,
          [fixture.member.userId],
          created.version
        );
      }
    );
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
  it("rejects duplicate names without changing the committed release", async () => {
    const fixture = await seedFixture();
    const service = createService();
    const created = await service.create(fixture.owner, {
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
    expect(await service.get(fixture.owner, created.id)).toMatchObject({
      activeRelease: created.activeRelease,
      bundle: created.bundle,
    });
    expect(
      (
        await getPostgresDatabase(env)
          .query<{
            count: number;
          }>({
            ...{
              text: 'SELECT COUNT(*) AS count FROM "openmeld"."organization_skills" WHERE organization_id = $1',
              values: [],
            },
            values: [fixture.organizationId],
          })
          .then((result) => result.rows[0] ?? null)
      )?.count
    ).toBe(1);
  });
  it("rejects management actions before the enabled runtime catalog exceeds its limits", async () => {
    const fixture = await seedFixture();
    const service = createService();
    let firstSkill: {
      id: string;
      version: number;
    } | null = null;
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
        db: getPostgresDatabase(env),
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
    await getPostgresDatabase(env).query({
      ...{
        text: `
        UPDATE "openmeld"."organization_skill_releases"
        SET manifest_json = jsonb_set(
          manifest_json::jsonb,
          '{runtimeBytes}',
          to_jsonb($1::bigint)
        )::text
        WHERE id = $2
      `,
        values: [],
      },
      values: [
        ORGANIZATION_SKILL_RUNTIME_CATALOG_MAX_BYTES,
        blocker.activeRelease.id,
      ],
    });
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
    const candidateManifest = await getPostgresDatabase(env)
      .query<{
        manifest_json: string;
      }>({
        ...{
          text: `
        SELECT manifest_json
        FROM "openmeld"."organization_skill_releases"
        WHERE id = $1
      `,
          values: [],
        },
        values: [candidate.activeRelease.id],
      })
      .then((result) => result.rows[0] ?? null);
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
    await getPostgresDatabase(env).query({
      ...{
        text: `
        UPDATE "openmeld"."organization_skill_releases"
        SET manifest_json = jsonb_set(
          manifest_json::jsonb,
          '{runtimeBytes}',
          to_jsonb($1::bigint)
        )::text
        WHERE id = $2
      `,
        values: [],
      },
      values: [
        ORGANIZATION_SKILL_RUNTIME_CATALOG_MAX_BYTES - candidateRuntimeBytes,
        blocker.activeRelease.id,
      ],
    });
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
  it("installs one local portable Skill package atomically", async () => {
    const fixture = await seedFixture();
    const service = createService();
    const markdown =
      "---\nname: local-review\ndescription: Review local notes.\n---\nRead the checklist.";
    const files = [
      {
        content: markdown,
        encoding: "utf8" as const,
        mediaType: "text/markdown",
        path: "SKILL.md",
        size: new TextEncoder().encode(markdown).byteLength,
      },
      {
        content: "# Checklist",
        encoding: "utf8" as const,
        mediaType: "text/markdown",
        path: "references/checklist.md",
        size: 11,
      },
    ];
    await expect(
      service.previewFromFiles(fixture.member, files)
    ).rejects.toMatchObject({
      cause: { code: "organization_skill.manage_forbidden", status: 403 },
    });
    const preview = await service.previewFromFiles(fixture.owner, files);
    expect(preview).toMatchObject({
      files: [{ path: "references/checklist.md", size: 11 }],
      portable: { name: "local-review" },
    });
    expect(await service.list(fixture.owner)).toHaveLength(0);
    await expect(
      service.importFromFiles(fixture.member, files)
    ).rejects.toMatchObject({
      cause: { code: "organization_skill.manage_forbidden", status: 403 },
    });
    const installed = await service.importFromFiles(fixture.owner, files);
    expect(installed).toMatchObject({
      bundle: {
        instructions: "Read the checklist.",
        portable: { name: "local-review" },
        files: [{ path: "references/checklist.md", content: "# Checklist" }],
      },
      source: { kind: "created" },
    });
    const reference = files[1];
    if (!reference) {
      throw new Error("Local Skill reference fixture is missing.");
    }
    await expect(
      service.importFromFiles(fixture.owner, [
        ...files,
        { ...reference, path: "nested/SKILL.md" },
      ])
    ).rejects.toMatchObject({
      cause: { code: "organization_skill.invalid_bundle", status: 400 },
    });
    expect(await service.list(fixture.owner)).toHaveLength(1);
  });
  it("enforces the portable Agent Skills description limit", async () => {
    const fixture = await seedFixture();
    const service = createService();
    const filesWithDescription = (description: string) => {
      const markdown = `---\nname: detailed-skill\ndescription: ${description}\n---\nUse the reference.`;
      return [
        {
          content: markdown,
          encoding: "utf8" as const,
          mediaType: "text/markdown",
          path: "SKILL.md",
          size: new TextEncoder().encode(markdown).byteLength,
        },
      ];
    };
    const validDescription = "A".repeat(1024);
    await expect(
      service.previewFromFiles(
        fixture.owner,
        filesWithDescription(validDescription)
      )
    ).resolves.toMatchObject({ portable: { description: validDescription } });
    await expect(
      service.previewFromFiles(
        fixture.owner,
        filesWithDescription("A".repeat(1068))
      )
    ).rejects.toMatchObject({
      cause: {
        code: "organization_skill.frontmatter_invalid",
        status: 400,
      },
      message: expect.stringContaining("Agent Skills 1024-character limit"),
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
      message: expect.stringContaining(
        `release/SKILL.md is ${ORGANIZATION_SKILL_BUNDLE_MAX_BYTES + 1} bytes; the single-file limit is ${ORGANIZATION_SKILL_FILE_MAX_BYTES} bytes.`
      ),
    });
    expect(
      fetchMock.mock.calls.some(([request]) =>
        String(request).startsWith("https://raw.githubusercontent.com/")
      )
    ).toBe(false);
  });
  it("rejects a GitHub blob that exceeds its declared size while reading it", async () => {
    const commitSha = "c".repeat(40);
    const fetchMock = vi.fn<typeof fetch>((request) => {
      const url = String(request);
      if (url.includes(`/git/trees/${commitSha}?recursive=1`)) {
        return Promise.resolve(
          Response.json({
            tree: [
              {
                mode: "100644",
                path: "release/SKILL.md",
                size: 1,
                type: "blob",
              },
            ],
            truncated: false,
          })
        );
      }
      if (url.startsWith("https://raw.githubusercontent.com/")) {
        return Promise.resolve(new Response("unexpectedly large body"));
      }
      return Promise.resolve(readGitHubFixtureResponse(url, commitSha));
    });
    await expect(
      importOrganizationSkillBundleFromGitHub({
        fetch: fetchMock,
        url: "https://github.com/acme/skills",
      })
    ).rejects.toMatchObject({
      cause: {
        code: "organization_skill.github_response_invalid",
        status: 400,
      },
      message: expect.stringContaining("more content than declared"),
    });
  });
  it("keeps the UTF-8 BOM and byte size of an imported Skill resource", async () => {
    const commitSha = "b".repeat(40);
    const resourceContent = "\uFEFF<schema/>";
    const resourceBytes = new TextEncoder().encode(resourceContent);
    const fetchMock = vi.fn<typeof fetch>((request) => {
      const url = String(request);
      if (url.includes(`/git/trees/${commitSha}?recursive=1`)) {
        return Promise.resolve(
          Response.json({
            tree: [
              {
                mode: "100644",
                path: "release/SKILL.md",
                size: new TextEncoder().encode(GITHUB_SKILL_MARKDOWN)
                  .byteLength,
                type: "blob",
              },
              {
                mode: "100644",
                path: "release/references/schema.xml",
                size: resourceBytes.byteLength,
                type: "blob",
              },
            ],
            truncated: false,
          })
        );
      }
      if (url.endsWith(`/${commitSha}/release/references/schema.xml`)) {
        return Promise.resolve(new Response(resourceBytes));
      }
      return Promise.resolve(readGitHubFixtureResponse(url, commitSha));
    });
    const imported = await importOrganizationSkillBundleFromGitHub({
      fetch: fetchMock,
      url: "https://github.com/acme/skills",
    });
    expect(imported.bundle.files).toEqual([
      expect.objectContaining({
        content: resourceContent,
        encoding: "utf8",
        path: "references/schema.xml",
        size: resourceBytes.byteLength,
      }),
    ]);
  });
  it("rejects invalid GitHub frontmatter before fetching supporting files", async () => {
    const commitSha = "b".repeat(40);
    const markdown = `---\nname: release-review\ndescription: ${"A".repeat(1068)}\n---\nUse the reference.`;
    const resourcePath = "release/references/large.txt";
    const fetchMock = vi.fn<typeof fetch>((request) => {
      const url = String(request);
      if (url.includes(`/git/trees/${commitSha}?recursive=1`)) {
        return Promise.resolve(
          Response.json({
            tree: [
              {
                mode: "100644",
                path: "release/SKILL.md",
                size: new TextEncoder().encode(markdown).byteLength,
                type: "blob",
              },
              {
                mode: "100644",
                path: resourcePath,
                size: 100,
                type: "blob",
              },
            ],
            truncated: false,
          })
        );
      }
      if (url.endsWith(`/${commitSha}/release/SKILL.md`)) {
        return Promise.resolve(new Response(markdown));
      }
      if (url.endsWith(`/${commitSha}/${resourcePath}`)) {
        throw new Error(
          "Supporting resource was fetched before SKILL.md validation."
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
      cause: { code: "organization_skill.frontmatter_invalid", status: 400 },
    });
    expect(
      fetchMock.mock.calls.some(([request]) =>
        String(request).endsWith(`/${commitSha}/${resourcePath}`)
      )
    ).toBe(false);
  });
  it("previews every Skill directory and its blockers without downloading bundles", async () => {
    const commitSha = "e".repeat(40);
    const fetchMock = vi.fn<typeof fetch>((request) => {
      const url = String(request);
      if (url.includes(`/git/trees/${commitSha}?recursive=1`)) {
        return Promise.resolve(
          Response.json({
            tree: [
              { path: "skills/ready/SKILL.md", size: 100, type: "blob" },
              { path: "skills/ready/scripts/run.py", size: 30, type: "blob" },
              { path: "skills/blocked/SKILL.md", size: 100, type: "blob" },
              {
                path: "skills/blocked/references/large.pdf",
                size: ORGANIZATION_SKILL_FILE_MAX_BYTES + 1,
                type: "blob",
              },
            ],
            truncated: false,
          })
        );
      }
      return Promise.resolve(readGitHubFixtureResponse(url, commitSha));
    });
    const preview = await previewOrganizationSkillRepositoryFromGitHub({
      fetch: fetchMock,
      url: "https://github.com/acme/skills?ref=main",
    });
    expect(preview).toMatchObject({
      commitSha,
      skills: [
        {
          path: "skills/blocked",
          fileCount: 2,
          blocker: {
            code: "organization_skill.bundle_too_large",
            message: expect.stringContaining(
              "skills/blocked/references/large.pdf"
            ),
          },
        },
        {
          path: "skills/ready",
          fileCount: 2,
          blocker: null,
          warnings: [expect.stringContaining("not executable")],
        },
      ],
    });
    expect(
      fetchMock.mock.calls.some(([request]) =>
        String(request).startsWith("https://raw.githubusercontent.com/")
      )
    ).toBe(false);
  });
  it("can review a repository with more Skills than the runtime can enable", async () => {
    const commitSha = "a".repeat(40);
    const fetchMock = vi.fn<typeof fetch>((request) => {
      const url = String(request);
      if (url.includes(`/git/trees/${commitSha}?recursive=1`)) {
        return Promise.resolve(
          Response.json({
            tree: Array.from(
              { length: ORGANIZATION_SKILL_RUNTIME_RELEASE_LIMIT + 1 },
              (_, index) => ({
                path: `skills/skill-${index}/SKILL.md`,
                size: 100,
                type: "blob",
              })
            ),
            truncated: false,
          })
        );
      }
      return Promise.resolve(readGitHubFixtureResponse(url, commitSha));
    });
    const preview = await previewOrganizationSkillRepositoryFromGitHub({
      fetch: fetchMock,
      url: "https://github.com/acme/skills",
    });
    expect(preview.skills).toHaveLength(
      ORGANIZATION_SKILL_RUNTIME_RELEASE_LIMIT + 1
    );
    expect(
      organizationSkillGitHubRepositoryPreviewSchema.safeParse(preview).success
    ).toBe(true);
  });
  it("imports a previewed Skill whose GitHub directory contains spaces and Unicode", async () => {
    const commitSha = "a".repeat(40);
    const path = "skills/My Skill 中文";
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    const fetchMock = vi.fn<typeof fetch>((request) => {
      const url = String(request);
      if (url.endsWith(`/repos/acme/skills/commits/${commitSha}`)) {
        return Promise.resolve(Response.json({ sha: commitSha }));
      }
      if (url.includes(`/git/trees/${commitSha}?recursive=1`)) {
        return Promise.resolve(
          Response.json({
            tree: [
              {
                path: `${path}/SKILL.md`,
                size: new TextEncoder().encode(GITHUB_SKILL_MARKDOWN)
                  .byteLength,
                type: "blob",
              },
            ],
            truncated: false,
          })
        );
      }
      if (url.endsWith(`/${commitSha}/${encodedPath}/SKILL.md`)) {
        return Promise.resolve(new Response(GITHUB_SKILL_MARKDOWN));
      }
      return Promise.resolve(readGitHubFixtureResponse(url, commitSha));
    });
    const preview = await previewOrganizationSkillRepositoryFromGitHub({
      fetch: fetchMock,
      url: "https://github.com/acme/skills",
    });
    expect(preview.skills[0]?.url).toBe(
      `https://github.com/acme/skills/tree/${commitSha}/${encodedPath}`
    );
    const imported = await importOrganizationSkillBundleFromGitHub({
      fetch: fetchMock,
      url: preview.skills[0]?.url ?? "",
    });
    expect(imported.source.path).toBe(path);
    expect(imported.bundle.portable.name).toBe("release-review");
  });
  it("inspects a selected Skill when GitHub truncates the repository tree", async () => {
    const commitSha = "a".repeat(40);
    const rootSha = "b".repeat(40);
    const skillsSha = "c".repeat(40);
    const selectedSha = "d".repeat(40);
    const referencesSha = "e".repeat(40);
    const unrelatedSha = "f".repeat(40);
    const markdown = [
      "---",
      "name: selected-skill",
      "description: Use the selected Skill.",
      "---",
      "Read the guide.",
    ].join("\n");
    const guide = "# Selected guide";
    const fetchMock = vi.fn<typeof fetch>((request) => {
      const url = String(request);
      if (url.endsWith(`/${commitSha}/skills/selected/SKILL.md`)) {
        return Promise.resolve(new Response(markdown));
      }
      if (url.endsWith(`/${commitSha}/skills/selected/references/guide.md`)) {
        return Promise.resolve(new Response(guide));
      }
      if (url.includes(`/git/trees/${commitSha}?recursive=1`)) {
        return Promise.resolve(
          Response.json({ sha: rootSha, tree: [], truncated: true })
        );
      }
      const trees: Record<string, unknown[]> = {
        [rootSha]: [
          { path: "skills", sha: skillsSha, type: "tree" },
          { path: "unrelated", sha: unrelatedSha, type: "tree" },
        ],
        [skillsSha]: [
          { path: "selected", sha: selectedSha, type: "tree" },
          { path: "other", sha: unrelatedSha, type: "tree" },
        ],
        [selectedSha]: [
          { path: "SKILL.md", size: markdown.length, type: "blob" },
          { path: "references", sha: referencesSha, type: "tree" },
        ],
        [referencesSha]: [
          { path: "guide.md", size: guide.length, type: "blob" },
        ],
      };
      const sha = url.split("/git/trees/")[1];
      if (sha && trees[sha]) {
        return Promise.resolve(
          Response.json({ tree: trees[sha], truncated: false })
        );
      }
      return Promise.resolve(readGitHubFixtureResponse(url, commitSha));
    });
    const preview = await previewOrganizationSkillRepositoryFromGitHub({
      fetch: fetchMock,
      url: "https://github.com/acme/skills/tree/main/skills/selected",
    });
    expect(preview.skills).toMatchObject([
      {
        path: "skills/selected",
        fileCount: 2,
        totalBytes: markdown.length + guide.length,
      },
    ]);
    const imported = await importOrganizationSkillBundleFromGitHub({
      fetch: fetchMock,
      expectedCommitSha: commitSha,
      url: "https://github.com/acme/skills/tree/main/skills/selected",
    });
    expect(imported.bundle.files).toMatchObject([
      { path: "references/guide.md", content: guide },
    ]);
    expect(
      fetchMock.mock.calls.some(([request]) =>
        String(request).includes(`/git/trees/${unrelatedSha}`)
      )
    ).toBe(false);
    const incompleteFetch = vi.fn<typeof fetch>((request) => {
      const url = String(request);
      if (url.includes(`/git/trees/${commitSha}?recursive=1`)) {
        return Promise.resolve(
          Response.json({ sha: rootSha, tree: [], truncated: true })
        );
      }
      if (url.endsWith(`/git/trees/${rootSha}`)) {
        return Promise.resolve(Response.json({ tree: [], truncated: true }));
      }
      return Promise.resolve(readGitHubFixtureResponse(url, commitSha));
    });
    await expect(
      previewOrganizationSkillRepositoryFromGitHub({
        fetch: incompleteFetch,
        url: "https://github.com/acme/skills/tree/main/skills/selected",
      })
    ).rejects.toMatchObject({
      cause: { code: "organization_skill.github_tree_too_large" },
    });
  });
  it("keeps root Skill resources while excluding nested Skill packages", async () => {
    const commitSha = "f".repeat(40);
    const markdown = [
      "---",
      "name: root-skill",
      "description: Use the root Skill.",
      "---",
      "Follow the root instructions.",
    ].join("\n");
    const nestedMarkdown = markdown.replace("root-skill", "nested-skill");
    const files = new Map([
      ["SKILL.md", markdown],
      ["references/guide.md", "# Guide"],
      ["scripts/run.py", "print('hello')"],
      ["nested/SKILL.md", nestedMarkdown],
      ["nested/assets/example.txt", "Nested asset"],
    ]);
    const fetchMock = vi.fn<typeof fetch>((request) => {
      const url = String(request);
      if (url.endsWith(`/repos/acme/skills/commits/${commitSha}`)) {
        return Promise.resolve(Response.json({ sha: commitSha }));
      }
      if (url.includes(`/git/trees/${commitSha}?recursive=1`)) {
        return Promise.resolve(
          Response.json({
            tree: [...files].map(([path, content]) => ({
              mode: "100644",
              path,
              size: new TextEncoder().encode(content).byteLength,
              type: "blob",
            })),
            truncated: false,
          })
        );
      }
      if (
        url.startsWith(
          `https://raw.githubusercontent.com/acme/skills/${commitSha}/`
        )
      ) {
        const path = url.split(`/${commitSha}/`)[1] ?? "";
        const content = files.get(path);
        return Promise.resolve(
          content === undefined
            ? new Response("not found", { status: 404 })
            : new Response(content)
        );
      }
      return Promise.resolve(readGitHubFixtureResponse(url, commitSha));
    });
    const preview = await previewOrganizationSkillRepositoryFromGitHub({
      fetch: fetchMock,
      url: "https://github.com/acme/skills",
    });
    expect(preview.skills).toMatchObject([
      {
        fileCount: 3,
        path: "",
        totalBytes: [...files]
          .slice(0, 3)
          .reduce(
            (sum, [, content]) =>
              sum + new TextEncoder().encode(content).byteLength,
            0
          ),
        warnings: [expect.stringContaining("not executable")],
        url: `https://github.com/acme/skills/blob/${commitSha}/SKILL.md`,
      },
      { fileCount: 2, path: "nested" },
    ]);
    const rootFilePreview = await previewOrganizationSkillRepositoryFromGitHub({
      fetch: fetchMock,
      url: `https://github.com/acme/skills/blob/${commitSha}/SKILL.md`,
    });
    expect(rootFilePreview.skills).toMatchObject([{ path: "", fileCount: 3 }]);
    const imported = await importOrganizationSkillBundleFromGitHub({
      fetch: fetchMock,
      url: preview.skills[0]?.url ?? "",
    });
    expect(imported.bundle.files.map((file) => file.path)).toEqual([
      "references/guide.md",
      "scripts/run.py",
    ]);
    expect(imported.source.path).toBe("");
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
    expect(
      fetchMock.mock.calls.some(([request]) =>
        String(request).endsWith(
          `/${commitSha}/release/references/checklist.md`
        )
      )
    ).toBe(false);
    await expect(
      service.previewFromGitHub(
        fixture.member,
        "https://github.com/acme/skills"
      )
    ).rejects.toMatchObject({
      cause: { code: "organization_skill.manage_forbidden", status: 403 },
    });
  });
  it("replays a human GitHub install without creating another release", async () => {
    const fixture = await seedFixture();
    const profile = await getPostgresDatabase(env)
      .query<{
        profile_id: string;
      }>({
        ...{
          text: 'SELECT profile_id FROM "openmeld"."openmeld_profiles" WHERE owner_user_id = $1 AND profile_kind = \'human\' LIMIT 1',
          values: [],
        },
        values: [fixture.owner.userId],
      })
      .then((result) => result.rows[0] ?? null);
    if (!profile) {
      throw new Error("Human test profile is missing.");
    }
    const commitSha = "c".repeat(40);
    const fetchMock = vi.fn<typeof fetch>((request) =>
      Promise.resolve(readGitHubFixtureResponse(String(request), commitSha))
    );
    const request = {
      context: {
        activeOrganizationId: fixture.organizationId,
        actorContext: {
          callerPrincipalId: fixture.owner.userId,
          openMeldProfileId: profile.profile_id,
          profileKind: "human" as const,
          requestId: `skill-request-${crypto.randomUUID()}`,
        },
      },
      expectedCommitSha: commitSha,
      expectedOrganizationId: fixture.organizationId,
      operationId: "human-install-release-review",
      url: "https://github.com/acme/skills/tree/main/release",
    };
    vi.stubGlobal("fetch", fetchMock);
    try {
      const installed = await rpcImportOrganizationSkillFromGitHub(
        coreEnv(),
        request
      );
      const fetchedAfterInstall = fetchMock.mock.calls.length;
      await expect(
        rpcImportOrganizationSkillFromGitHub(coreEnv(), request)
      ).resolves.toEqual(installed);
      expect(fetchMock).toHaveBeenCalledTimes(fetchedAfterInstall);
      const count = await getPostgresDatabase(env)
        .query<{
          count: number;
        }>({
          ...{
            text: 'SELECT COUNT(*) AS count FROM "openmeld"."organization_skills" WHERE organization_id = $1',
            values: [],
          },
          values: [fixture.organizationId],
        })
        .then((result) => result.rows[0] ?? null);
      expect(count?.count).toBe(1);
      await getPostgresDatabase(env).query({
        ...{
          text: 'UPDATE "openmeld"."organization_skill_import_operations" SET completed_at = NULL, response_json = NULL, created_at = 0 WHERE organization_id = $1',
          values: [],
        },
        values: [fixture.organizationId],
      });
      await expect(
        rpcImportOrganizationSkillFromGitHub(coreEnv(), request)
      ).resolves.toEqual(installed);
      await expect(
        rpcImportOrganizationSkillFromGitHub(coreEnv(), {
          ...request,
          url: "https://github.com/acme/other/tree/main/release",
        })
      ).rejects.toMatchObject({
        cause: { code: "organization_skill.operation_conflict", status: 409 },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("recovers a pinned batch and its installed result across requests", async () => {
    const fixture = await seedFixture();
    const profile = await getPostgresDatabase(env)
      .query<{
        profile_id: string;
      }>({
        ...{
          text: 'SELECT profile_id FROM "openmeld"."openmeld_profiles" WHERE owner_user_id = $1 AND profile_kind = \'human\' LIMIT 1',
          values: [],
        },
        values: [fixture.owner.userId],
      })
      .then((result) => result.rows[0] ?? null);
    if (!profile) {
      throw new Error("Human test profile is missing.");
    }
    const commitSha = "c".repeat(40);
    let resourceUnavailable = true;
    const fetchMock = vi.fn<typeof fetch>((request) =>
      Promise.resolve(
        resourceUnavailable &&
          String(request).endsWith("/release/references/checklist.md")
          ? new Response("not found", { status: 404 })
          : readGitHubFixtureResponse(String(request), commitSha)
      )
    );
    const context = {
      activeOrganizationId: fixture.organizationId,
      actorContext: {
        callerPrincipalId: fixture.owner.userId,
        openMeldProfileId: profile.profile_id,
        profileKind: "human" as const,
        requestId: `skill-request-${crypto.randomUUID()}`,
      },
    };
    const sourceUrl = "https://github.com/acme/skills";
    const batchId = crypto.randomUUID();
    vi.stubGlobal("fetch", fetchMock);
    try {
      const unselectedBatchId = crypto.randomUUID();
      const unselected = await rpcBeginOrganizationSkillImportBatch(coreEnv(), {
        batchId: unselectedBatchId,
        context,
        expectedOrganizationId: fixture.organizationId,
        selectedPaths: [],
        url: sourceUrl,
      });
      expect(unselected.batch.results).toMatchObject([
        { selected: false, status: "skipped", error: "Not selected" },
      ]);
      await expect(
        rpcImportOrganizationSkillFromGitHub(coreEnv(), {
          batchId: unselectedBatchId,
          context,
          expectedCommitSha: commitSha,
          expectedOrganizationId: fixture.organizationId,
          url: unselected.batch.preview.skills[0]?.url ?? "",
        })
      ).rejects.toMatchObject({
        cause: { code: "organization_skill.batch_conflict", status: 409 },
      });
      const started = await rpcBeginOrganizationSkillImportBatch(coreEnv(), {
        batchId,
        context,
        expectedOrganizationId: fixture.organizationId,
        url: sourceUrl,
      });
      expect(started.batch.results).toMatchObject([{ status: "pending" }]);
      const candidate = started.batch.preview.skills[0];
      if (!candidate) {
        throw new Error("GitHub fixture has no Skill.");
      }
      const installRequest = {
        batchId,
        context,
        expectedCommitSha: commitSha,
        expectedOrganizationId: fixture.organizationId,
        url: candidate.url,
      };
      await expect(
        rpcImportOrganizationSkillFromGitHub(coreEnv(), installRequest)
      ).rejects.toThrow();
      expect(
        (
          await rpcGetOrganizationSkillImportBatch(coreEnv(), {
            batchId,
            context,
          })
        ).batch.results
      ).toMatchObject([
        { status: "failed", error: expect.not.stringContaining("HTTP 4") },
      ]);
      expect(
        (await rpcListOrganizationSkillImportBatches(coreEnv(), { context }))
          .batches
      ).toMatchObject([{ batchId, failedCount: 1, pendingCount: 0 }]);
      resourceUnavailable = false;
      const installed = await rpcImportOrganizationSkillFromGitHub(
        coreEnv(),
        installRequest
      );
      const recovered = await rpcGetOrganizationSkillImportBatch(coreEnv(), {
        batchId,
        context,
      });
      expect(recovered.batch.results).toMatchObject([
        {
          path: candidate.path,
          releaseId: installed.skill.activeRelease.id,
          skillId: installed.skill.id,
          status: "installed",
        },
      ]);
      expect(
        (await rpcListOrganizationSkillImportBatches(coreEnv(), { context }))
          .batches
      ).toEqual([]);
      await expect(
        rpcBeginOrganizationSkillImportBatch(coreEnv(), {
          batchId,
          context,
          expectedOrganizationId: fixture.organizationId,
          url: `${sourceUrl}/tree/${commitSha}`,
        })
      ).resolves.toEqual(recovered);
      const count = await getPostgresDatabase(env)
        .query<{
          count: number;
        }>({
          ...{
            text: 'SELECT COUNT(*) AS count FROM "openmeld"."organization_skills" WHERE organization_id = $1',
            values: [],
          },
          values: [fixture.organizationId],
        })
        .then((result) => result.rows[0] ?? null);
      expect(count?.count).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("resumes one pinned batch across Center Agent and Web without repeating a successful item", async () => {
    const fixture = await seedFixture();
    const profile = await getPostgresDatabase(env)
      .query<{ profile_id: string }>({
        text: 'SELECT profile_id FROM "openmeld"."openmeld_profiles" WHERE owner_user_id = $1 AND profile_kind = \'human\' LIMIT 1',
        values: [fixture.owner.userId],
      })
      .then((result) => result.rows[0] ?? null);
    if (!profile) {
      throw new Error("Missing fixture profile.");
    }
    const commitSha = "c".repeat(40);
    let docsUnavailable = true;
    const fetchMock = vi.fn<typeof fetch>(async (request) => {
      const url = String(request);
      if (url.includes(`/git/trees/${commitSha}?recursive=1`)) {
        const original = (await readGitHubFixtureResponse(
          url,
          commitSha
        ).json()) as { tree: { path: string }[] };
        return Response.json({
          ...original,
          tree: [
            ...original.tree,
            ...original.tree.map((entry) => ({
              ...entry,
              path: entry.path.replace("release/", "docs/"),
            })),
          ],
        });
      }
      if (url.endsWith("/docs/references/checklist.md") && docsUnavailable) {
        return new Response("unavailable", { status: 503 });
      }
      const response = readGitHubFixtureResponse(
        url.replace("/docs/", "/release/"),
        commitSha
      );
      if (url.endsWith("/docs/SKILL.md")) {
        return new Response(
          (await response.text()).replace("release-review", "preview-review")
        );
      }
      return response;
    });
    const context = centerAgentRequestContext(fixture);
    const speakerMember = {
      memberId: fixture.ownerMemberId,
      userId: fixture.owner.userId,
    };
    const humanContext = {
      activeOrganizationId: fixture.organizationId,
      actorContext: {
        callerPrincipalId: fixture.owner.userId,
        openMeldProfileId: profile.profile_id,
        profileKind: "human" as const,
        requestId: crypto.randomUUID(),
      },
    };
    const batchId = crypto.randomUUID();
    const beginRequest = {
      action: "begin_import_batch" as const,
      batchId,
      context,
      speakerMember,
      expectedCommitSha: commitSha,
      selectedPaths: ["release", "docs"],
      url: "https://github.com/acme/skills",
    };
    const itemRequest = {
      action: "install_batch_item" as const,
      batchId,
      context,
      speakerMember,
      path: "release",
    };
    vi.stubGlobal("fetch", fetchMock);
    try {
      const plan = await rpcCenterAgentInstallOrganizationSkill(
        coreEnv(),
        beginRequest
      );
      if (plan.action !== "begin_import_batch") {
        throw new Error("Expected batch plan.");
      }
      expect(plan.batch.results).toHaveLength(2);
      const first = await rpcCenterAgentInstallOrganizationSkill(
        coreEnv(),
        itemRequest
      );
      if (first.action !== "install_batch_item") {
        throw new Error("Expected installed item.");
      }
      const callsAfterInstall = fetchMock.mock.calls.length;
      const candidate = plan.batch.preview.skills.find(
        (item) => item.path === "release"
      );
      if (!candidate) {
        throw new Error("Missing release candidate.");
      }
      const replay = await rpcImportOrganizationSkillFromGitHub(coreEnv(), {
        batchId,
        context: humanContext,
        expectedCommitSha: commitSha,
        expectedOrganizationId: fixture.organizationId,
        url: candidate.url,
      });
      expect(replay.skill.id).toBe(first.skill.id);
      expect(fetchMock).toHaveBeenCalledTimes(callsAfterInstall);
      await expect(
        rpcCenterAgentInstallOrganizationSkill(coreEnv(), {
          ...itemRequest,
          path: "docs",
        })
      ).rejects.toThrow();
      const partial = await rpcCenterAgentReadOrganizationSkills(coreEnv(), {
        action: "get_import_batch",
        batchId,
        context,
        speakerMember,
      });
      expect(partial).toMatchObject({
        batch: {
          results: expect.arrayContaining([
            {
              path: "release",
              selected: true,
              status: "installed",
              skillId: first.skill.id,
              releaseId: first.skill.activeRelease.id,
            },
            expect.objectContaining({ path: "docs", status: "failed" }),
          ]),
        },
      });
      expect(
        await rpcCenterAgentReadOrganizationSkills(coreEnv(), {
          action: "list_import_batches",
          context,
          speakerMember,
        })
      ).toMatchObject({
        batches: [{ batchId, installedCount: 1, failedCount: 1 }],
      });
      docsUnavailable = false;
      await rpcCenterAgentInstallOrganizationSkill(coreEnv(), {
        ...itemRequest,
        path: "docs",
      });
      const complete = await rpcGetOrganizationSkillImportBatch(coreEnv(), {
        batchId,
        context: humanContext,
      });
      expect(
        complete.batch.results.every((item) => item.status === "installed")
      ).toBe(true);
      const counts = await getPostgresDatabase(env)
        .query<{ count: number }>({
          text: 'SELECT COUNT(*) AS count FROM "openmeld"."organization_skills" WHERE organization_id = $1',
          values: [fixture.organizationId],
        })
        .then((result) => result.rows[0] ?? null);
      expect(counts?.count).toBe(2);
      await expect(
        rpcCenterAgentInstallOrganizationSkill(coreEnv(), {
          ...beginRequest,
          selectedPaths: ["docs"],
        })
      ).rejects.toMatchObject({
        cause: { code: "organization_skill.batch_conflict" },
      });
      await expect(
        rpcCenterAgentInstallOrganizationSkill(coreEnv(), {
          ...itemRequest,
          path: "outside-plan",
        })
      ).rejects.toMatchObject({
        cause: { code: "organization_skill.batch_conflict" },
      });
      await expect(
        rpcCenterAgentReadOrganizationSkills(coreEnv(), {
          action: "get_import_batch",
          batchId,
          context,
          speakerMember: {
            memberId: fixture.memberMemberId,
            userId: fixture.member.userId,
          },
        })
      ).rejects.toMatchObject({
        cause: { code: "organization_skill.manage_forbidden" },
      });
      const other = await seedFixture();
      await expect(
        rpcCenterAgentReadOrganizationSkills(coreEnv(), {
          action: "get_import_batch",
          batchId,
          context: centerAgentRequestContext(other),
          speakerMember: {
            memberId: other.ownerMemberId,
            userId: other.owner.userId,
          },
        })
      ).rejects.toMatchObject({
        cause: { code: "organization_skill.batch_missing" },
      });
    } finally {
      vi.unstubAllGlobals();
    }
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
    if (installed.action !== "create") {
      throw new Error("Expected a created Skill.");
    }
    expect(installed).not.toHaveProperty("warnings");
    const replayed = await rpcCenterAgentInstallOrganizationSkill(
      coreEnv(),
      request
    );
    expect(replayed).toEqual(installed);
    await getPostgresDatabase(env).query({
      ...{
        text: `
        UPDATE "openmeld"."center_agent_organization_skill_operations"
        SET completed_at = NULL, response_json = NULL, created_at = 0
        WHERE organization_id = $1
      `,
        values: [],
      },
      values: [fixture.organizationId],
    });
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
    const counts = await getPostgresDatabase(env)
      .query<{
        operations: number;
        skills: number;
      }>({
        ...{
          text: `
        SELECT
          (SELECT COUNT(*) FROM "openmeld"."organization_skills" WHERE organization_id = $1) AS skills,
          (SELECT COUNT(*) FROM "openmeld"."center_agent_organization_skill_operations" WHERE organization_id = $2) AS operations
      `,
          values: [],
        },
        values: [fixture.organizationId, fixture.organizationId],
      })
      .then((result) => result.rows[0] ?? null);
    expect(counts).toEqual({ operations: 1, skills: 1 });
    const audits = await getPostgresDatabase(env).query<{
      action: string;
      on_behalf_of_user_id: string | null;
    }>({
      ...{
        text: `
        SELECT action, on_behalf_of_user_id
        FROM "openmeld"."center_agent_audit_journal"
        WHERE organization_id = $1
        ORDER BY created_at ASC
      `,
        values: [],
      },
      values: [fixture.organizationId],
    });
    expect(audits.rows).toEqual([
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
  it("reports stored scripts and ignored tool hints after a GitHub install without changing the legacy reply", async () => {
    const fixture = await seedFixture();
    const commitSha = "f".repeat(40);
    const fetchMock = vi.fn<typeof fetch>((request) => {
      const url = String(request);
      if (url.includes(`/git/trees/${commitSha}?recursive=1`)) {
        return Promise.resolve(
          Response.json({
            tree: [
              {
                mode: "100644",
                path: "release/SKILL.md",
                size: new TextEncoder().encode(GITHUB_SKILL_MARKDOWN)
                  .byteLength,
                type: "blob",
              },
              {
                mode: "100644",
                path: "release/scripts/run.sh",
                size: 7,
                type: "blob",
              },
            ],
            truncated: false,
          })
        );
      }
      if (url.endsWith(`/${commitSha}/release/scripts/run.sh`)) {
        return Promise.resolve(new Response("echo ok"));
      }
      return Promise.resolve(readGitHubFixtureResponse(url, commitSha));
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const request = {
        action: "import_github_with_report" as const,
        context: centerAgentRequestContext(fixture),
        expectedCommitSha: commitSha,
        operationId: "install-reported-release",
        speakerMember: {
          memberId: fixture.ownerMemberId,
          userId: fixture.owner.userId,
        },
        url: "https://github.com/acme/skills/tree/main/release",
      };
      const installed = await rpcCenterAgentInstallOrganizationSkill(
        coreEnv(),
        request
      );
      expect(installed).toMatchObject({
        action: "import_github_with_report",
        storedButNotExecutable: ["scripts/run.sh"],
        warnings: [
          expect.stringContaining("not executable"),
          expect.stringContaining("does not grant OpenMeld permissions"),
        ],
      });
      await expect(
        rpcCenterAgentInstallOrganizationSkill(coreEnv(), request)
      ).resolves.toEqual(installed);
    } finally {
      vi.unstubAllGlobals();
    }
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
    if (installed.action !== "create") {
      throw new Error("Expected a created Skill.");
    }
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
  if (
    url.endsWith("/repos/acme/skills/commits/main") ||
    url.endsWith(`/repos/acme/skills/commits/${commitSha}`)
  ) {
    return Response.json({ sha: commitSha });
  }
  if (url.includes(`/git/trees/${commitSha}?recursive=1`)) {
    return Response.json({
      tree: [
        {
          mode: "100644",
          path: "release/SKILL.md",
          size: new TextEncoder().encode(GITHUB_SKILL_MARKDOWN).byteLength,
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
    return new Response(GITHUB_SKILL_MARKDOWN);
  }
  if (url.endsWith(`/${commitSha}/release/references/checklist.md`)) {
    return new Response("# Checklist");
  }
  return new Response("not found", { status: 404 });
}
function createService(
  input: {
    db?: PostgresDatabase;
    fetch?: typeof fetch;
    fileBackedWritesEnabled?: boolean;
  } = {}
) {
  return createOrganizationSkillService({
    bucket: env.OPENMELD_ORGANIZATION_SKILLS,
    db: input.db ?? getPostgresDatabase(env),
    fetch: input.fetch,
    fileBackedWritesEnabled: input.fileBackedWritesEnabled,
  });
}
function coreEnv(): CoreBindings {
  return {
    OPENMELD_POSTGRESQL: env.OPENMELD_POSTGRESQL,
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
  await getPostgresDatabase(env).query({
    ...{
      text: 'INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ($1, $2, $3, $4)',
      values: [],
    },
    values: [organizationId, "Skills Org", `skills-${suffix}`, 1000],
  });
  for (const [index, user] of users.entries()) {
    await getPostgresDatabase(env).query({
      ...{
        text: 'INSERT INTO "openmeld"."users" (id, name, email, email_verified, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)',
        values: [],
      },
      values: [
        user.id,
        user.name,
        `skills-${index}-${suffix}@example.com`,
        1,
        1000,
        1000,
      ],
    });
    await getPostgresDatabase(env).query({
      ...{
        text: 'INSERT INTO "openmeld"."members" (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, $4, $5)',
        values: [],
      },
      values: [
        `skill_membership_${index}_${suffix}`,
        organizationId,
        user.id,
        user.role,
        1000,
      ],
    });
    await getPostgresDatabase(env).query({
      ...{
        text: `
        INSERT INTO "openmeld"."openmeld_profiles" (
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
        ) VALUES ($1, $2, $3, 'human', 1, 'active', $4, $5, 'auth_bootstrap', $6, $7)
      `,
        values: [],
      },
      values: [
        crypto.randomUUID(),
        user.name,
        `skill-human-${index}-${suffix}`,
        user.id,
        user.id,
        1000,
        1000,
      ],
    });
  }
  const centerAgentProfileId = `agt_${crypto.randomUUID()}`;
  await getPostgresDatabase(env).query({
    ...{
      text: `
      INSERT INTO "openmeld"."openmeld_profiles" (
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
      ) VALUES ($1, 'Center Agent', $2, 'agent', 0, 'active', $3, NULL, $4, 'cli_create', 'center_agent', $5, $6)
    `,
      values: [],
    },
    values: [
      centerAgentProfileId,
      `skill-center-${suffix}`,
      organizationId,
      users[0].id,
      1000,
      1000,
    ],
  });
  await getPostgresDatabase(env).query({
    ...{
      text: `
      INSERT INTO "openmeld"."center_agent_designations" (
        organization_id,
        agent_profile_id,
        duty,
        designated_by,
        created_at
      ) VALUES ($1, $2, NULL, $3, $4)
    `,
      values: [],
    },
    values: [organizationId, centerAgentProfileId, users[0].id, 1000],
  });
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
