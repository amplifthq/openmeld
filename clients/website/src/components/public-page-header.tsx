import {
	type PublicPageHeaderProps,
	PublicPageHeader as SharedPublicPageHeader,
} from "@openmeld/ui/components/public-page-header";
import { appUrl } from "#/lib/app-url";
import { OpenAppButton } from "./open-app-button";
import { PublicPageNavigation } from "./public-page-navigation";

export function PublicPageHeader({
	appEntryPath = appUrl("/"),
	...props
}: Omit<PublicPageHeaderProps, "appEntryPath"> & {
	appEntryPath?: string | null;
}) {
	return (
		<SharedPublicPageHeader
			appEntryPath={appEntryPath}
			appEntrySlot={
				appEntryPath ? (
					<OpenAppButton href={appEntryPath} size="compact" />
				) : null
			}
			className="[&>div>div]:max-sm:contents [&>div]:max-sm:grid [&>div]:max-sm:grid-cols-[1fr_auto] [&>div]:max-sm:gap-y-1"
			navigationSlot={<PublicPageNavigation />}
			{...props}
		/>
	);
}
