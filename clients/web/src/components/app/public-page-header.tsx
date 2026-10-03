import {
	type PublicPageHeaderProps,
	PublicPageHeader as SharedPublicPageHeader,
} from "@openmeld/ui/components/public-page-header";

export const PUBLIC_APP_ENTRY_LABEL = "Log in";
export const PUBLIC_APP_ENTRY_PATH = "/login";

export function PublicPageHeader(
	props: Omit<PublicPageHeaderProps, "appEntryPath"> & { appEntryPath?: string }
) {
	return (
		<SharedPublicPageHeader
			appEntryPath={PUBLIC_APP_ENTRY_PATH}
			brandHref={import.meta.env.VITE_WEBSITE_URL}
			{...props}
		/>
	);
}
