import type { PostgresDatabase } from "@openmeld/db/postgresql";
import type { FeedbackReportingPolicyResponse } from "@openmeld/schemas/types";
import type { FeedbackReportingPolicyRepository } from "../../application/feedback-reporting-policy-service";

type FeedbackReportingPolicyRow = {
  organization_id: string;
  reporting_enabled: boolean | number;
  updated_by_user_id: string | null;
};
export function createPostgresFeedbackReportingPolicyRepository(input: {
  db: PostgresDatabase;
}): FeedbackReportingPolicyRepository {
  const readPolicy = async (
    organizationId: string
  ): Promise<FeedbackReportingPolicyResponse | null> => {
    const row = await input.db
      .query<FeedbackReportingPolicyRow>({
        text: `
          SELECT
            organization_id,
            reporting_enabled,
            updated_by_user_id
          FROM "openmeld"."openMeldFeedback_reporting_policies"
          WHERE organization_id = $1
          LIMIT 1
        `,
        values: [organizationId],
      })
      .then((result) => result.rows[0] ?? null);
    if (!row) {
      return null;
    }
    return {
      organizationId: row.organization_id,
      reportingEnabled: Boolean(row.reporting_enabled),
      updatedByUserId: row.updated_by_user_id,
    };
  };
  return {
    readPolicy,
    async upsertPolicy(policyInput) {
      await input.db.query({
        text: `
            INSERT INTO "openmeld"."openMeldFeedback_reporting_policies" (
              organization_id,
              reporting_enabled,
              updated_by_user_id,
              created_at_ms,
              updated_at_ms
            ) VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT(organization_id) DO UPDATE SET
              reporting_enabled = excluded.reporting_enabled,
              updated_by_user_id = excluded.updated_by_user_id,
              updated_at_ms = excluded.updated_at_ms
          `,
        values: [
          policyInput.organizationId,
          policyInput.reportingEnabled ? 1 : 0,
          policyInput.updatedByUserId,
          policyInput.nowMs,
          policyInput.nowMs,
        ],
      });
      const policy = await readPolicy(policyInput.organizationId);
      if (!policy) {
        throw new Error(
          "updated Feedback reporting policy could not be read back"
        );
      }
      return policy;
    },
  };
}
