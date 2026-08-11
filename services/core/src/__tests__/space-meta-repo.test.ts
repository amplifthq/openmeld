import { describe, expect, it, vi } from "vitest";
import type { SpacePasswordProof } from "../lib/space-password-proof";
import {
  readSpaceMetaRecordFromSql,
  type SpaceMetaRecord,
  upsertSpaceMetaRecord,
} from "../space/infrastructure/sql/space-meta-repo";

const NOW_MS = Date.UTC(2026, 5, 26, 12, 0, 0);
const NOW_ISO = new Date(NOW_MS).toISOString();
const PASSWORD_PROOF = {
  v: 1,
  alg: "pbkdf2-sha256",
  iter: 100_000,
  salt: "AAAAAAAAAAAAAAAAAAAAAA",
  hash: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
} as const satisfies SpacePasswordProof;

type SpaceMetaRow = {
  space_id: string;
  name: string | null;
  purpose: string | null;
  direct_message_json: string | null;
  creator_json: string | null;
  organization_id: string | null;
  organization_visibility: string | null;
  guide: string | null;
  access_mode: string | null;
  password_proof_json: string | null;
  created_at: number;
  updated_at: number;
};

function createMetaRow(input: {
  accessMode: string | null;
  passwordProof?: SpacePasswordProof;
}): SpaceMetaRow {
  return {
    space_id: "space-1",
    name: "Room",
    purpose: null,
    direct_message_json: null,
    creator_json: null,
    organization_id: "org-1",
    organization_visibility: "private",
    guide: null,
    access_mode: input.accessMode,
    password_proof_json: input.passwordProof
      ? JSON.stringify(input.passwordProof)
      : null,
    created_at: NOW_MS,
    updated_at: NOW_MS,
  };
}

function createReadSql(row: SpaceMetaRow | null): SqlStorage {
  return {
    exec: vi.fn(() => ({
      next: () =>
        row
          ? ({ done: false, value: row } as const)
          : ({ done: true } as const),
    })),
  } as unknown as SqlStorage;
}

function createWriteSql(): SqlStorage & { exec: ReturnType<typeof vi.fn> } {
  return {
    exec: vi.fn(() => ({
      next: () => ({ done: true }) as const,
    })),
  } as unknown as SqlStorage & { exec: ReturnType<typeof vi.fn> };
}

function createMetaRecord(input: {
  accessMode: SpaceMetaRecord["accessMode"];
  passwordProof?: SpacePasswordProof;
}): SpaceMetaRecord {
  return {
    v: 1,
    spaceId: "space-1",
    organizationId: "org-1",
    visibility: "private",
    accessMode: input.accessMode,
    ...(input.passwordProof ? { passwordProof: input.passwordProof } : {}),
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
  };
}

describe("space-meta-repo", () => {
  it("derives protected access for legacy rows with a password proof", () => {
    const sql = createReadSql(
      createMetaRow({ accessMode: null, passwordProof: PASSWORD_PROOF })
    );

    expect(readSpaceMetaRecordFromSql(sql, "space-1")).toMatchObject({
      accessMode: "protected",
      passwordProof: PASSWORD_PROOF,
    });
  });

  it("derives public access for legacy rows without a password proof", () => {
    const sql = createReadSql(createMetaRow({ accessMode: "   " }));

    expect(readSpaceMetaRecordFromSql(sql, "space-1")).toMatchObject({
      accessMode: "public",
    });
  });

  it("accepts public view with password-gated join when a proof exists", () => {
    const sql = createReadSql(
      createMetaRow({
        accessMode: "public_view_join_password",
        passwordProof: PASSWORD_PROOF,
      })
    );

    expect(readSpaceMetaRecordFromSql(sql, "space-1")).toMatchObject({
      accessMode: "public_view_join_password",
      passwordProof: PASSWORD_PROOF,
    });
  });

  it("fails closed when organization ownership is missing", () => {
    const sql = createReadSql({
      ...createMetaRow({ accessMode: "public" }),
      organization_id: null,
    });

    expect(() => readSpaceMetaRecordFromSql(sql, "space-1")).toThrow(
      "space_meta.organization_id required"
    );
  });

  it("fails closed when password-gated join has no password proof", () => {
    const sql = createReadSql(
      createMetaRow({ accessMode: "public_view_join_password" })
    );

    expect(() => readSpaceMetaRecordFromSql(sql, "space-1")).toThrow(
      "space_meta.access_mode public_view_join_password requires password proof"
    );
  });

  it("fails closed when public access has a password proof", () => {
    const sql = createReadSql(
      createMetaRow({ accessMode: "public", passwordProof: PASSWORD_PROOF })
    );

    expect(() => readSpaceMetaRecordFromSql(sql, "space-1")).toThrow(
      "space_meta.access_mode public must not have password proof"
    );
  });

  it("rejects invalid write combinations before touching SQL", () => {
    const publicWithPasswordSql = createWriteSql();
    expect(() =>
      upsertSpaceMetaRecord(
        publicWithPasswordSql,
        createMetaRecord({
          accessMode: "public",
          passwordProof: PASSWORD_PROOF,
        })
      )
    ).toThrow("space_meta.access_mode public must not have password proof");
    expect(publicWithPasswordSql.exec).not.toHaveBeenCalled();

    const joinPasswordWithoutProofSql = createWriteSql();
    expect(() =>
      upsertSpaceMetaRecord(
        joinPasswordWithoutProofSql,
        createMetaRecord({ accessMode: "public_view_join_password" })
      )
    ).toThrow(
      "space_meta.access_mode public_view_join_password requires password proof"
    );
    expect(joinPasswordWithoutProofSql.exec).not.toHaveBeenCalled();
  });
});
