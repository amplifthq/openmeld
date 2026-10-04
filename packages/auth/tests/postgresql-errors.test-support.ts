import errors from "./fixtures/postgresql-unique-errors.json";

export function createCapturedPostgresUniqueError(
  key: "organizationActive" | "profileOwnerHandle"
) {
  const fixture = errors[key];
  return Object.assign(new Error(fixture.message), fixture);
}
