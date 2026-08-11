export type RemoteAgentDailyAdmissionResult =
  | {
      dayUtc: string;
      status: "admitted";
    }
  | {
      dayUtc: string;
      status: "rejected";
    };

type NativeDeliveryAdmissionRow = {
  daily_admission_day_utc: string | null;
};

export async function admitRemoteAgentDailyDelivery(input: {
  db: D1Database;
  idempotencyKey: string;
  limit: number;
  nowMs: number;
  organizationId: string;
}): Promise<RemoteAgentDailyAdmissionResult> {
  const existing = await readNativeDeliveryAdmission(input);
  if (existing?.daily_admission_day_utc) {
    return {
      dayUtc: existing.daily_admission_day_utc,
      status: "admitted",
    };
  }

  const dayUtc = resolveUtcDay(input.nowMs);
  const [counterResult] = await input.db.batch([
    input.db
      .prepare(
        `
          INSERT INTO openMeldRemoteAgent_daily_admissions (
            organization_id,
            day_utc,
            admitted_count,
            last_admission_idempotency_key,
            created_at_ms,
            updated_at_ms
          )
          SELECT ?, ?, 1, ?, ?, ?
          WHERE EXISTS (
            SELECT 1
            FROM openMeldRemoteAgent_native_delivery_ledger
            WHERE organization_id = ?
              AND idempotency_key = ?
              AND daily_admission_day_utc IS NULL
          )
          ON CONFLICT (organization_id, day_utc) DO UPDATE SET
            admitted_count = admitted_count + 1,
            last_admission_idempotency_key = excluded.last_admission_idempotency_key,
            updated_at_ms = excluded.updated_at_ms
          WHERE admitted_count < ?
            AND EXISTS (
              SELECT 1
              FROM openMeldRemoteAgent_native_delivery_ledger
              WHERE organization_id = ?
                AND idempotency_key = ?
                AND daily_admission_day_utc IS NULL
            )
          RETURNING admitted_count
        `
      )
      .bind(
        input.organizationId,
        dayUtc,
        input.idempotencyKey,
        input.nowMs,
        input.nowMs,
        input.organizationId,
        input.idempotencyKey,
        input.limit,
        input.organizationId,
        input.idempotencyKey
      ),
    input.db
      .prepare(
        `
          UPDATE openMeldRemoteAgent_native_delivery_ledger
          SET
            daily_admission_day_utc = ?,
            updated_at_ms = max(updated_at_ms, ?)
          WHERE organization_id = ?
            AND idempotency_key = ?
            AND daily_admission_day_utc IS NULL
            AND EXISTS (
              SELECT 1
              FROM openMeldRemoteAgent_daily_admissions
              WHERE organization_id = ?
                AND day_utc = ?
                AND last_admission_idempotency_key = ?
            )
        `
      )
      .bind(
        dayUtc,
        input.nowMs,
        input.organizationId,
        input.idempotencyKey,
        input.organizationId,
        dayUtc,
        input.idempotencyKey
      ),
  ]);

  const admittedDelivery = await readNativeDeliveryAdmission(input);
  if (admittedDelivery?.daily_admission_day_utc) {
    return {
      dayUtc: admittedDelivery.daily_admission_day_utc,
      status: "admitted",
    };
  }

  if (resolveChangedRowCount(counterResult) > 0) {
    throw new Error(
      `Remote Agent daily admission counted ${input.idempotencyKey} without marking its native delivery ledger row`
    );
  }
  return { dayUtc, status: "rejected" };
}

async function readNativeDeliveryAdmission(input: {
  db: D1Database;
  idempotencyKey: string;
  organizationId: string;
}): Promise<NativeDeliveryAdmissionRow | null> {
  return await input.db
    .prepare(
      `
        SELECT daily_admission_day_utc
        FROM openMeldRemoteAgent_native_delivery_ledger
        WHERE organization_id = ? AND idempotency_key = ?
        LIMIT 1
      `
    )
    .bind(input.organizationId, input.idempotencyKey)
    .first<NativeDeliveryAdmissionRow>();
}

function resolveChangedRowCount(result: D1Result | undefined): number {
  const changes = result?.meta?.changes;
  return typeof changes === "number" ? changes : 0;
}

function resolveUtcDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}
