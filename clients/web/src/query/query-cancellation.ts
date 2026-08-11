const QUERY_CANCELLATION_ERROR_NAMES = new Set([
	"AbortError",
	"CancelledError",
	"CanceledError",
]);

export function isQueryCancellationError(error: unknown): boolean {
	const name = readStringProperty(error, "name");
	if (name && QUERY_CANCELLATION_ERROR_NAMES.has(name)) {
		return true;
	}

	const constructorName =
		error instanceof Error
			? error.constructor.name
			: readConstructorName(error);
	if (constructorName && QUERY_CANCELLATION_ERROR_NAMES.has(constructorName)) {
		return true;
	}

	const message = readErrorMessage(error).toLowerCase();
	return (
		message.includes("cancellederror") ||
		message.includes("cancelederror") ||
		message.includes("aborterror")
	);
}

function readErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	if (typeof error === "string") {
		return error;
	}
	const message = readStringProperty(error, "message");
	return message ?? "";
}

function readConstructorName(error: unknown): string | null {
	if (!(typeof error === "object" && error !== null)) {
		return null;
	}
	const errorConstructor = (error as { constructor?: unknown }).constructor;
	if (!(typeof errorConstructor === "function")) {
		return null;
	}
	return errorConstructor.name || null;
}

function readStringProperty(
	error: unknown,
	key: "message" | "name"
): string | null {
	if (!(typeof error === "object" && error !== null)) {
		return null;
	}
	const value = (error as Record<string, unknown>)[key];
	return typeof value === "string" ? value : null;
}
