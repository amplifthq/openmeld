import {
	type PublicPageHeaderProps,
	PublicPageHeader as SharedPublicPageHeader,
} from "@openmeld/ui/components/public-page-header";
import { appUrl } from "#/lib/app-url";

export function PublicPageHeader(
	props: Omit<PublicPageHeaderProps, "appEntryPath"> & { appEntryPath?: string }
) {
	return (
		<SharedPublicPageHeader
			appEntryLabel="Open app"
			appEntryPath={appUrl("/")}
			{...props}
		/>
	);
}
