import { readPluginConnectionReplyLink } from "@openmeld/schemas";
import { useEffect, useMemo, useState } from "react";
import { getDesktopPlatform } from "#/desktop/platform";

/** Old clients render a working link; new clients enhance only a trusted origin. */
export function usePluginConnectionReply(input: {
	final: boolean;
	organizationSlug?: string;
	text: string;
}) {
	const [webOrigin, setWebOrigin] = useState<string | null>(null);
	const eligible =
		input.final && input.text.endsWith("#openmeld-plugin-connection)");
	useEffect(() => {
		if (!eligible) {
			return;
		}
		let current = true;
		const desktop = getDesktopPlatform();
		if (!desktop) {
			setWebOrigin(window.location.origin);
			return;
		}
		desktop
			.platform()
			.then((platform) => {
				if (current) {
					setWebOrigin(platform.webOrigin);
				}
			})
			.catch(() => {
				// A missing trusted origin leaves the ordinary link visible.
				if (current) {
					setWebOrigin(null);
				}
			});
		return () => {
			current = false;
		};
	}, [eligible]);
	return useMemo(
		() =>
			eligible && webOrigin && input.organizationSlug
				? readPluginConnectionReplyLink({
						organizationSlug: input.organizationSlug,
						text: input.text,
						webOrigin,
					})
				: null,
		[eligible, input.organizationSlug, input.text, webOrigin]
	);
}
