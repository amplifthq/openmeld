// Fixed synthetic identities for the isolated business-owner probe only.
export const identities = {
  owner: "00000000-0000-4000-8000-000000001460",
  member: "00000000-0000-4000-8000-000000001461",
  profile: "00000000-0000-4000-8000-000000001462",
  organization: "00000000-0000-4000-8000-000000001463",
  otherOrganization: "00000000-0000-4000-8000-000000001464",
  operation: "00000000-0000-4000-8000-000000001465",
};
export const marker = "Hyperdrive business acceptance 台北 😀 literal \\n";

export async function seedBusinessFixture(client) {
  await client.query("BEGIN");
  try {
    const tables = (
      await client.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema='openmeld' ORDER BY table_name"
      )
    ).rows;
    if (tables.length !== 168) {
      throw new Error(
        "Expected the reviewed complete native application schema"
      );
    }
    for (const { table_name: table } of tables) {
      const name = `"${table.replaceAll('"', '""')}"`;
      if (
        (await client.query(`SELECT 1 FROM openmeld.${name} LIMIT 1`)).rows
          .length
      ) {
        throw new Error(
          "Business fixture requires an empty application schema; inspect existing data instead of reseeding"
        );
      }
    }
    const now = Date.now();
    for (const [id, email] of [
      [identities.owner, "cloud-business-owner@example.com"],
      [identities.member, "cloud-business-member@example.com"],
    ]) {
      await client.query(
        "INSERT INTO openmeld.users(id,name,email,email_verified,created_at,updated_at) VALUES($1,$2,$3,1,$4,$4)",
        [id, "Synthetic cloud business fixture", email, now]
      );
    }
    for (const id of [identities.organization, identities.otherOrganization]) {
      await client.query(
        "INSERT INTO openmeld.organizations(id,name,slug,created_at,created_by_user_id) VALUES($1,$2,$3,$4,$5)",
        [
          id,
          "Synthetic cloud business fixture",
          `cloud-${id}`,
          now,
          identities.owner,
        ]
      );
    }
    for (const [id, role] of [
      [identities.owner, "owner"],
      [identities.member, "member"],
    ]) {
      await client.query(
        "INSERT INTO openmeld.members(id,organization_id,user_id,role,created_at) VALUES($1,$2,$3,$4,$5)",
        [`cloud-${id}`, identities.organization, id, role, now]
      );
    }
    await client.query("COMMIT");
    return { users: 2, organizations: 2, memberships: 2 };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
