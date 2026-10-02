import { toast } from "sonner";
import { getDesktopPlatform } from "#/desktop/platform";
import { copyTextToClipboard } from "#/lib/clipboard";

/** Use the Desktop platform's public Web origin, never its renderer origin. */
export async function copyAppLink(path: string): Promise<boolean> {
	const bridge = getDesktopPlatform();
	const origin = bridge
		? (await bridge.platform()).webOrigin
		: window.location.origin;
	return copyTextToClipboard(new URL(path, origin).href);
}

export async function copyAppLinkWithFeedback(path: string): Promise<void> {
	try {
		if (await copyAppLink(path)) {
			toast.success("Link copied");
		} else {
			toast.error("Couldn't copy the link. Try again.");
		}
	} catch {
		toast.error("Couldn't copy the link. Try again.");
	}
}
