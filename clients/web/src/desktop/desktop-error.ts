// Only known, user-facing native failures may cross into UI copy. IPC
// wrappers and arbitrary SDK responses can contain implementation or auth data.
const knownMessages = new Set([
	"OpenMeld is still waiting for the background update. Current tasks and the update continue. Check their status, then try connecting again.",
	"Could not connect to OpenMeld. Check your connection and try again.",
	"This version of OpenMeld is not supported by the server. Check for an app update.",
	"OpenMeld is unavailable right now. Try again shortly.",
	"Desktop could not verify server compatibility. Check for an app update or try again later.",
	"This sign-in could not be completed. Sign in with your browser again.",
	"Could not open your workspace. Check your connection and try again.",
	"Desktop sign-in changed. Check the account and try again.",
	"This CLI and Service do not support this action. Update OpenMeld through Web and check again.",
	"Check your Desktop sign-in before controlling this Service.",
	"A Service action is still in progress. Check its status before trying again.",
	"A computer connection is already in progress.",
	"OpenMeld cannot verify this computer with the installed tools. Run OpenMeld setup on the selected computer, then try again.",
	"OpenMeld cannot read this Mac's Service identity. Start OpenMeld Service on this Mac, then try again.",
	"Open Desktop on the selected computer, then try again.",
	"Computer changes are unavailable in this Desktop pilot. Manage this computer in OpenMeld Web.",
	"This test build does not include a local computer connection environment.",
	"Connecting this computer requires an Apple silicon Mac.",
	"OpenMeld Tools could not be downloaded. Check your connection and try again.",
	"OpenMeld Tools are unavailable for this Mac.",
	"OpenMeld Tools do not include a verified signing identity.",
	"OpenMeld Tools returned an unexpected download location.",
]);
const IPC_ERROR_PREFIX = /^Error invoking remote method '[^']+': (?:Error: )?/;

export function formatDesktopError(error: unknown, fallback: string): string {
	if (!(error instanceof Error)) {
		return fallback;
	}
	const message = error.message.replace(IPC_ERROR_PREFIX, "");
	return knownMessages.has(message) ? message : fallback;
}
