-- Serialize observed timezone writes with irreversible account closure.
CREATE TRIGGER live_account_reference BEFORE INSERT OR UPDATE ON "openmeld"."user_time_contexts"
FOR EACH ROW EXECUTE FUNCTION "openmeld"."require_live_account_reference"('user_id');
