ALTER TABLE "openmeld"."agent_access_requests" ADD COLUMN "decision" text;--> statement-breakpoint
-- Backfill the owner's answer. An allowed request wrote its grant in the
-- same transaction: an `always` grant means Always allow; a `once` grant, or
-- none, means Allow once. A void request keeps the answer its grant records.
UPDATE "openmeld"."agent_access_requests" AS request
  SET "decision" = CASE
    WHEN request."status" = 'declined' THEN 'decline'
    WHEN request."status" = 'joined' THEN 'join'
    WHEN request."status" = 'ignored' THEN 'ignore'
    WHEN grant_row."scope" = 'always' THEN 'always_allow'
    WHEN grant_row."scope" = 'once' OR request."status" = 'allowed' THEN 'allow_once'
    ELSE NULL
  END
  FROM "openmeld"."agent_access_requests" AS source
  LEFT JOIN "openmeld"."agent_profile_access_grants" AS grant_row
    ON grant_row."request_id" = source."id"
  WHERE source."id" = request."id"
    AND request."status" IN ('allowed', 'declined', 'joined', 'ignored', 'voided');--> statement-breakpoint
ALTER TABLE "openmeld"."agent_access_requests" ADD CONSTRAINT "agent_access_requests_owner_decision_check" CHECK (("decision" is null and "status" in ('pending', 'withdrawn', 'voided', 'replied_by_dm'))
        or ("decision" in ('allow_once', 'always_allow') and "status" in ('allowed', 'voided'))
        or ("decision" = 'decline' and "status" = 'declined')
        or ("decision" = 'join' and "status" in ('joined', 'voided'))
        or ("decision" = 'ignore' and "status" = 'ignored'));