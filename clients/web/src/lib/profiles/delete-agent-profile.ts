import {
	agentProfileIdSchema,
	deletedAgentProfileActionResponseSchema,
} from "@openmeld/schemas";
import {
	OrganizationRequestError,
	requestAuthBusiness,
} from "#/lib/auth-business";
export async function deleteStartAgentProfile({ data }: { data: string }) {
	const profileId = agentProfileIdSchema.parse(data);
	try {
		return (
			await requestAuthBusiness({
				path: `/v1/profiles/agents/${encodeURIComponent(profileId)}`,
				method: "DELETE",
				schema: deletedAgentProfileActionResponseSchema,
			})
		).profile;
	} catch (error) {
		if (error instanceof OrganizationRequestError && error.status === 404) {
			throw new Error("Agent Profile was already removed.");
		}
		throw error;
	}
}
