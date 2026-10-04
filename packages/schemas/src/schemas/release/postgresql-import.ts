import { z } from "zod/v4";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);

export const postgresqlD1RemoteSourceSchema = z.strictObject({
  kind: z.literal("cloudflare-d1"),
  accountId: z.string().regex(/^[a-f0-9]{32}$/u),
  databaseId: z.uuid(),
});

export const postgresqlRemoteImportTargetSchema = z.strictObject({
  kind: z.literal("planetscale"),
  organization: z.literal("amplift"),
  databaseId: z.string().min(1),
  branchId: z.string().min(1),
  host: z.string().endsWith(".pg.psdb.cloud"),
  database: z.literal("postgres"),
});

// Capture evidence only. This does not certify that DO/R2 or external writers
// have stopped, and the maintenance ledger never becomes application data.
export const postgresqlD1MaintenanceCaptureSchema = z.strictObject({
  maintenanceId: z.uuid(),
  state: z.literal("frozen"),
  tables: z.number().int().positive().safe(),
  guards: z.number().int().positive().safe(),
  catalogSha256: sha256,
  ledger: z.strictObject({
    schema: z.string().min(1),
    rows: z
      .array(
        z.strictObject({
          id: z.string().regex(/^\d+$/u),
          name: z.string().min(1),
          applied_at: z.string().min(1),
        })
      )
      .min(1),
  }),
});

// Migration tooling only. This records one committed import, not current
// business state, writer quiescence, or permission to promote a cloud release.
export const postgresqlImportCompletionSchema = z.strictObject({
  version: z.literal(1),
  importId: z.uuid(),
  status: z.literal("committed_and_reconciled"),
  snapshotSha256: sha256,
  captureReceiptSha256: sha256,
  sourceSchemaSha256: sha256,
  historySha256: sha256,
  target: z.union([
    z.strictObject({
      systemIdentifier: z.string().regex(/^\d+$/u),
      databaseOid: z.string().regex(/^\d+$/u),
      database: z.string().min(1),
      dataDirectory: z.string().min(1),
    }),
    postgresqlRemoteImportTargetSchema,
  ]),
  nativeJournal: z
    .array(
      z.strictObject({
        name: z.string().min(1),
        checksum: sha256,
      })
    )
    .min(1),
  tables: z
    .array(
      z.strictObject({
        table: z.string().min(1),
        rows: z.number().int().nonnegative().safe(),
      })
    )
    .min(1),
  identities: z.array(
    z.strictObject({
      table: z.string().min(1),
      column: z.string().min(1),
    })
  ),
});

export type PostgresqlImportCompletion = z.infer<
  typeof postgresqlImportCompletionSchema
>;
