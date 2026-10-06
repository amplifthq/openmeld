// biome-ignore-all lint/suspicious/noMisplacedAssertion: Operational acceptance asserts real business-owner outcomes.
import assert from "node:assert/strict";
import { createAuthDatabase } from "@openmeld/db/auth";
import {
  getPostgresRequestPool,
  type PostgreSQLBinding,
  PostgresDatabase,
  withPostgresRequest,
} from "@openmeld/db/postgresql";
import { createDrizzleOpenMeldProfileRepository } from "../../packages/auth/src/profiles/profile-repository";
import { createProjectService } from "../../services/core/src/projects/project-service";

import { identities, marker } from "./business-fixture.mjs";

const forbidden = /HTTP 403:/;
const notFound = /HTTP 404:/;

/** Real business owners; intentionally not an HTTP Auth or full cloud UI claim. */
export async function acceptCloudBusiness(
  binding: PostgreSQLBinding,
  phase: "write" | "read"
) {
  const pool = await withPostgresRequest(binding, async () => {
    const db = new PostgresDatabase(binding);
    const profiles = createDrizzleOpenMeldProfileRepository(
      createAuthDatabase()
    );
    const projects = createProjectService({ db });
    const roles = (
      await db.query<{ user_id: string; role: string }>({
        text: "SELECT user_id,role FROM openmeld.members WHERE organization_id=$1 ORDER BY user_id",
        values: [identities.organization],
      })
    ).rows;
    assert.deepEqual(roles, [
      { user_id: identities.owner, role: "owner" },
      { user_id: identities.member, role: "member" },
    ]);
    const owner = {
      organizationId: identities.organization,
      userId: roles[0].user_id,
      role: roles[0].role,
    };
    const member = {
      organizationId: identities.organization,
      userId: roles[1].user_id,
      role: roles[1].role,
    };
    if (phase === "write") {
      await profiles.insertPrimaryHumanProfile({
        profileId: identities.profile,
        profileName: "Cloud business fixture",
        profileHandle: "cloud-business-fixture",
        ownerUserId: identities.owner,
        source: "web_create",
      });
      await profiles.updateProfileIdentityForOwner(
        identities.owner,
        identities.profile,
        { profileName: marker, profileHandle: "cloud-business-fixture" }
      );
      const project = await projects.create(owner, {
        name: "Cloud business fixture",
        slug: "cloud-business-fixture",
        operationId: identities.operation,
      });
      await projects.update(owner, project.id, { name: marker });
    }
    const profile = await profiles.findByOwnerAndProfileId(
      identities.owner,
      identities.profile
    );
    assert.equal(profile?.profileName, marker);
    assert.equal(
      await profiles.findByOwnerAndProfileId(
        identities.member,
        identities.profile
      ),
      null
    );
    await profiles.updateProfileIdentityForOwner(
      identities.member,
      identities.profile,
      {
        profileName: "Forbidden overwrite",
        profileHandle: "forbidden-overwrite",
      }
    );
    assert.equal(
      (
        await profiles.findByOwnerAndProfileId(
          identities.owner,
          identities.profile
        )
      )?.profileName,
      marker
    );
    const list = await projects.list(owner);
    assert.equal(list.projects.length, 1);
    const project = list.projects[0];
    assert.equal(project.name, marker);
    assert.equal(project.slug, "cloud-business-fixture");
    await assert.rejects(
      projects.update(member, project.id, { name: "Forbidden overwrite" }),
      forbidden
    );
    await assert.rejects(
      projects.read(
        { ...owner, organizationId: identities.otherOrganization },
        project.id
      ),
      notFound
    );
    assert.equal((await projects.read(owner, project.id)).name, marker);
    return getPostgresRequestPool();
  });
  assert.equal(pool.totalCount, 0);
  return {
    phase,
    profileOwnerIsolation: true,
    projectTenantIsolation: true,
    projectMemberDenied: true,
    requestPoolClosed: true,
  };
}
