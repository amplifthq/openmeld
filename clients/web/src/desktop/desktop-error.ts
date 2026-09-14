// Only known, user-facing native failures may cross into sign-in copy. IPC
// wrappers and arbitrary SDK responses can contain implementation or auth data.
const knownMessages = new Set([
	"Could not connect to OpenMeld. Check your connection and try again.",
	"This version of OpenMeld Desktop is not supported by the server. Check for an app update.",
	"OpenMeld is unavailable right now. Try again shortly.",
	"Desktop could not verify server compatibility. Check for an app update or try again later.",
	"This sign-in could not be completed. Sign in with your browser again.",
	"Your workspace could not be opened. Try signing in again.",
]);
const IPC_ERROR_PREFIX = /^Error invoking remote method '[^']+': (?:Error: )?/;

export function formatDesktopError(error: unknown, fallback: string): string {
	if (!(error instanceof Error)) {
		return fallback;
	}
	const message = error.message.replace(IPC_ERROR_PREFIX, "");
	return knownMessages.has(message) ? message : fallback;
}
