import { OpenAppButton as SharedOpenAppButton } from "@openmeld/ui/components/open-app-button";
import { appUrl } from "#/lib/app-url";
import { PlatformMetalBadge } from "./platform-metal-badge";

export function OpenAppButton({
	href = appUrl("/"),
	size = "hero",
}: {
	href?: string;
	size?: "hero" | "compact";
}) {
	return (
		<SharedOpenAppButton
			badgeSlot={<PlatformMetalBadge appearance="ring">Web</PlatformMetalBadge>}
			href={href}
			size={size}
		/>
	);
}
