type PendingRead = {
  statement: D1PreparedStatement;
  resolve: (row: unknown) => void;
  reject: (error: unknown) => void;
};

const MAX_READ_BATCH_SIZE = 32;

// Request-local execution of existing SELECT ... LIMIT 1 statements. This
// batches transport only: repositories still own SQL and row validation.
// Results are not cached, and different physical databases never share a batch.
export function createD1ReadBatch() {
  const pendingByDatabase = new Map<D1Database, PendingRead[]>();
  return {
    first<Row>(
      db: D1Database,
      statement: D1PreparedStatement
    ): Promise<Row | null> {
      return new Promise((resolve, reject) => {
        let pending = pendingByDatabase.get(db);
        if (!pending) {
          const queued: PendingRead[] = [];
          pending = queued;
          pendingByDatabase.set(db, queued);
          queueMicrotask(() => {
            pendingByDatabase.delete(db);
            flushReads(db, queued).catch((error) => {
              for (const read of queued) {
                read.reject(error);
              }
            });
          });
        }
        pending.push({
          statement,
          resolve: (row) => resolve(row as Row | null),
          reject,
        });
      });
    },
  };
}

export type D1ReadBatch = ReturnType<typeof createD1ReadBatch>;

async function flushReads(
  db: D1Database,
  pending: PendingRead[]
): Promise<void> {
  for (let offset = 0; offset < pending.length; offset += MAX_READ_BATCH_SIZE) {
    const batch = pending.slice(offset, offset + MAX_READ_BATCH_SIZE);
    try {
      const results = await db.batch(batch.map((read) => read.statement));
      if (
        results.length !== batch.length ||
        results.some(
          (result) => !(result.success && Array.isArray(result.results))
        )
      ) {
        throw new Error("Incomplete D1 readiness read batch.");
      }
      for (let index = 0; index < batch.length; index += 1) {
        batch[index]?.resolve(results[index]?.results[0] ?? null);
      }
    } catch (error) {
      for (const read of batch) {
        read.reject(error);
      }
    }
  }
}
