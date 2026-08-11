import { buttonVariants } from "@openmeld/ui/components/button";
import { cn } from "@openmeld/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { CrossPageHeader } from "./cross-page-header";

export const PUBLIC_APP_ENTRY_LABEL = "Login";
export const PUBLIC_APP_ENTRY_PATH = "/login";

type PublicPageHeaderProps = {
	appEntryLabel?: string;
	appEntryPath?: string;
	appEntryClassName?: string;
	brandLinkClassName?: string;
	className?: string;
	statusLabel?: string | null;
};

export function PublicPageHeader({
	appEntryLabel = PUBLIC_APP_ENTRY_LABEL,
	appEntryPath = PUBLIC_APP_ENTRY_PATH,
	appEntryClassName,
	brandLinkClassName,
	className,
	statusLabel,
}: PublicPageHeaderProps) {
	return (
		<CrossPageHeader
			brandLinkClassName={brandLinkClassName}
			brandStatusLabel={statusLabel}
			className={className}
			navigationSlot={
				<Link
					className={cn(
						buttonVariants({
							className: "rounded-md",
							size: "sm",
							variant: "outline",
						}),
						appEntryClassName
					)}
					to={appEntryPath}
				>
					{appEntryLabel}
				</Link>
			}
		/>
	);
}
