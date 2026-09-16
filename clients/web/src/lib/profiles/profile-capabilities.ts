import { profileCapabilitiesResponseSchema } from "@openmeld/schemas";
import { requestAuthBusiness } from "#/lib/auth-business";
export const getProfileCapabilities = () =>
	requestAuthBusiness({
		path: "/v1/profiles/capabilities",
		method: "GET",
		schema: profileCapabilitiesResponseSchema,
		profileSessionError: true,
	});
