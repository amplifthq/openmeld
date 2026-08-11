export type QueryPersistenceDiagnostic = {
	durationMs?: number;
	errorName?: string;
	event:
		| "clear_failed"
		| "clear_succeeded"
		| "corruption_failed"
		| "database_blocked"
		| "database_open_failed"
		| "database_open_succeeded"
		| "database_version_changed"
		| "quota_failed"
		| "restore_buster_mismatch"
		| "restore_expired"
		| "restore_failed"
		| "restore_hit"
		| "restore_miss"
		| "restore_timed_out"
		| "save_failed"
		| "save_succeeded"
		| "serialization_failed";
	scopeHash?: string;
	scopeKind: "account" | "all" | "organization" | "space";
	sizeBytes?: number;
};

export type QueryPersistenceDiagnostics = {
	record: (event: QueryPersistenceDiagnostic) => void;
};

export const defaultQueryPersistenceDiagnostics: QueryPersistenceDiagnostics = {
	record: (diagnostic) => {
		const event = {
			...diagnostic,
			event: `web.openmeld.browser_query_persistence.${diagnostic.event}`,
		};
		switch (diagnostic.event) {
			case "clear_failed":
			case "corruption_failed":
			case "database_open_failed":
			case "quota_failed":
			case "restore_failed":
			case "save_failed":
			case "serialization_failed":
				console.error(event);
				return;
			case "database_blocked":
			case "restore_timed_out":
				console.warn(event);
				return;
			case "database_open_succeeded":
			case "database_version_changed":
			case "restore_buster_mismatch":
			case "restore_expired":
			case "restore_hit":
			case "restore_miss":
				console.info(event);
				return;
			case "clear_succeeded":
			case "save_succeeded":
				return;
			default: {
				const unhandled: never = diagnostic.event;
				throw new Error(
					`Unhandled browser query persistence diagnostic: ${unhandled}`
				);
			}
		}
	},
};

export function hashDiagnosticScope(...parts: string[]): string {
	// Diagnostics need stable correlation without recording raw account or
	// Organization identifiers. FNV-1a is sufficient here because this is not a
	// security token or authority boundary.
	let hash = 5381;
	for (const character of parts.join("\u001f")) {
		hash = (hash * 33 + (character.codePointAt(0) ?? 0)) % 4_294_967_296;
	}
	return Math.floor(hash).toString(16).padStart(8, "0");
}

export function resolvePersistenceErrorName(error: unknown): string {
	if (
		typeof error === "object" &&
		error !== null &&
		"name" in error &&
		typeof error.name === "string"
	) {
		return error.name;
	}
	return typeof error;
}
