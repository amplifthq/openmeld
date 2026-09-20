import type { AnchorHTMLAttributes, MouseEvent } from "react";
import { toast } from "sonner";
import {
	openAuthorizationBrowser,
	prepareAuthorizationBrowser,
} from "./authorization-browser";
import { getDesktopPlatform } from "./platform";

export function AuthorizationLink(
	props: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }
) {
	const { onClick, ...anchorProps } = props;
	const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
		onClick?.(event);
		if (event.defaultPrevented || !getDesktopPlatform()) {
			return;
		}
		event.preventDefault();
		const browser = prepareAuthorizationBrowser("openmeld-authorization");
		if (!browser) {
			toast.error(
				"Your browser blocked authorization. Allow pop-ups and try again."
			);
			return;
		}
		openAuthorizationBrowser(browser, props.href).catch((error: unknown) => {
			toast.error(
				error instanceof Error
					? error.message
					: "Could not open authorization. Try again."
			);
		});
	};
	return <a {...anchorProps} href={props.href} onClick={handleClick} />;
}
