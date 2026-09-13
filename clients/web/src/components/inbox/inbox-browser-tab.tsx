import { useTheme } from "next-themes";
import { useEffect, useRef } from "react";
import { FAVICON_32_URL } from "#/lib/favicon";
import { resolveInboxIndicatorClassName } from "#/lib/inbox/attention";
import {
	applyInboxTabTitle,
	renderInboxTabIcon,
} from "#/lib/inbox/browser-tab";
import { useInboxAttention } from "./use-inbox-attention";

export function InboxBrowserTab(input: { organizationId: string }) {
	// Observe the existing summary cache, including while this tab is hidden.
	const attention = useInboxAttention(input.organizationId, true);
	const { resolvedTheme } = useTheme();
	const swatch = useRef<HTMLSpanElement>(null);

	useEffect(() => applyInboxTabTitle(attention.tabLabel), [attention.tabLabel]);

	useEffect(() => {
		if (!(attention.indicatorTone && swatch.current && resolvedTheme)) {
			return;
		}
		const icons = Array.from(
			document.head.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')
		);
		const originals = icons.map((icon) => ({
			icon,
			href: icon.href,
			type: icon.type,
		}));
		if (icons.length === 0) {
			return;
		}
		let active = true;
		const color = getComputedStyle(swatch.current).backgroundColor;
		renderInboxTabIcon(FAVICON_32_URL, color)
			.then((href) => {
				if (!active) {
					return;
				}
				for (const { icon } of originals) {
					icon.href = href;
					icon.type = "image/png";
				}
			})
			.catch((error: unknown) => {
				if (active) {
					console.warn("[openmeld.inbox.tab_icon_failed]", error);
				}
			});
		return () => {
			active = false;
			for (const { icon, href, type } of originals) {
				icon.href = href;
				icon.type = type;
			}
		};
	}, [attention.indicatorTone, resolvedTheme]);

	// Resolve the same themed CSS color as the in-product Inbox indicator.
	return (
		<span
			aria-hidden="true"
			className={resolveInboxIndicatorClassName(attention.tone)}
			hidden
			ref={swatch}
		/>
	);
}
