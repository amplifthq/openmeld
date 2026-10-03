import { z } from "zod/v4";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);

// Local migration tooling only. This records one committed import, not current
// business state, writer quiescence, or permission to promote a cloud release.
export const postgresqlImportCompletionSchema = z.strictObject({
  version: z.literal(1),
  importId: z.uuid(),
  status: z.literal("committed_and_reconciled"),
  snapshotSha256: sha256,
  captureReceiptSha256: sha256,
  sourceSchemaSha256: sha256,
  historySha256: sha256,
  target: z.strictObject({
    systemIdentifier: z.string().regex(/^\d+$/u),
    databaseOid: z.string().regex(/^\d+$/u),
    database: z.string().min(1),
    dataDirectory: z.string().min(1),
  }),
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
