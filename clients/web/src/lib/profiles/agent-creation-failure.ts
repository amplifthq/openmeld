const HTTP_ERROR_PREFIX = /^HTTP \d{3}:\s*/;

// Older records contain the RPC transport envelope in failureMessage. Keep the
// stored evidence intact while presenting its message as ordinary product copy.
export function formatAgentCreationFailure(raw: string): string {
	const body = raw.replace(HTTP_ERROR_PREFIX, "");
	try {
		const value: unknown = JSON.parse(body);
		if (typeof value === "object" && value !== null && "error" in value) {
			const error = value.error;
			if (
				typeof error === "object" &&
				error !== null &&
				"message" in error &&
				typeof error.message === "string"
			) {
				if (
					"code" in error &&
					error.code ===
						"agent_profile.workspace_change_eligibility_unavailable"
				) {
					return "Couldn’t prepare the working folder. Retry setup.";
				}
				return error.message;
			}
		}
	} catch {
		// Plain messages are already displayable; malformed evidence stays visible.
	}
	return body;
}
