const HTTP_ERROR_PREFIX = /^HTTP \d{3}:\s*/;

function explainCreationFailure(
	message: string,
	profileCreated: boolean
): string {
	if (
		message ===
			"The selected local agent is no longer available on that Computer." ||
		message === "The selected local agent is not connected."
	) {
		return profileCreated
			? "Your Agent was created, but its local agent is no longer available. Open the Agent to check its computer connection, then retry setup."
			: "OpenMeld can no longer use the local agent selected for this setup. Choose a connected computer to try again, or cancel setup if you no longer need this Agent.";
	}
	if (message === "The selected Computer is no longer reachable.") {
		return "OpenMeld can’t reach the selected computer. Open OpenMeld on that computer to reconnect, then retry setup.";
	}
	if (message.endsWith("is not ready to connect.")) {
		return `${message} Open OpenMeld on that computer and check that the local agent is installed and signed in. Then retry setup.`;
	}
	return message;
}

// Older records contain the RPC transport envelope in failureMessage. Keep the
// stored evidence intact while presenting its message as ordinary product copy.
export function formatAgentCreationFailure(
	raw: string,
	profileCreated = false
): string {
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
				return explainCreationFailure(error.message, profileCreated);
			}
		}
	} catch {
		// Plain messages are already displayable; malformed evidence stays visible.
	}
	return explainCreationFailure(body, profileCreated);
}
