import { useLocation, useRouter } from "@tanstack/react-router";
import type { AnchorHTMLAttributes, MouseEvent } from "react";
import { toast } from "sonner";
import { isDesktopAppHref } from "../../../desktop/src/shared/navigation";
import { getDesktopPlatform } from "./platform";

export function DesktopAwareLink(
	props: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }
) {
	if (!getDesktopPlatform()) {
		return <a {...props} />;
	}
	return <DesktopNativeAwareLink {...props} />;
}

function DesktopNativeAwareLink(
	props: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }
) {
	const openDesktopLink = useDesktopLinkOpener();
	const { onAuxClick, onClick, ...anchorProps } = props;
	const open = (
		event: MouseEvent<HTMLAnchorElement>,
		explicitBrowser: boolean
	) => openDesktopLink(event, props.href, explicitBrowser);
	return (
		<a
			{...anchorProps}
			href={props.href}
			onAuxClick={(event) => {
				onAuxClick?.(event);
				if (!event.defaultPrevented && event.button === 1) {
					open(event, true);
				}
			}}
			onClick={(event) => {
				onClick?.(event);
				if (!event.defaultPrevented) {
					open(event, false);
				}
			}}
		/>
	);
}

export function useDesktopLinkOpener() {
	const router = useRouter();
	const currentHref = useLocation({ select: (location) => location.href });
	return (
		event: MouseEvent<HTMLAnchorElement>,
		href: string,
		explicitBrowser = false
	) => {
		const bridge = getDesktopPlatform();
		if (!bridge) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		bridge
			.platform()
			.then(async (platform) => {
				const currentWebUrl = new URL(currentHref, platform.webOrigin);
				const url = new URL(href, currentWebUrl);
				const appHref = `${url.pathname}${url.search}${url.hash}`;
				const browserRequested =
					explicitBrowser || event.metaKey || event.ctrlKey || event.shiftKey;
				if (
					!browserRequested &&
					url.origin === platform.webOrigin &&
					isDesktopAppHref(appHref)
				) {
					router.history.push(appHref);
					return;
				}
				await bridge.openExternal(url.href);
			})
			.catch((error: unknown) => {
				toast.error(
					error instanceof Error
						? error.message
						: "Could not open this link. Try again."
				);
			});
	};
}
