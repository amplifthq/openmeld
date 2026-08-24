import { cn } from "@openmeld/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
	AppBrandStatusLabel,
	type AppBrandStatusLabelValue,
	OPENMELD_APP_STATUS_LABEL,
} from "./app-brand-status-label";
import { CrossPageHeaderNavigation } from "./cross-page-header-navigation";
import { CrossPageWordmark } from "./cross-page-wordmark";
import {
	APP_PAGE_FRAME_PADDING_CLASS_NAME,
	type AppShellSection,
	resolveAppShellFrameClassName,
} from "./shell-layout";

type CrossPageHeaderProps = {
	brandLinkClassName?: string;
	brandStatusLabel?: AppBrandStatusLabelValue;
	className?: string;
	currentSection?: AppShellSection | null;
	frameSection?: AppShellSection;
	includeSpaces?: boolean;
	navigationSlot?: ReactNode;
	showNavigation?: boolean;
};

export function CrossPageHeader({
	brandLinkClassName,
	brandStatusLabel = OPENMELD_APP_STATUS_LABEL,
	className,
	currentSection = null,
	frameSection,
	includeSpaces,
	navigationSlot,
	showNavigation = true,
}: CrossPageHeaderProps) {
	const headerRightContent =
		navigationSlot ??
		(showNavigation ? (
			<CrossPageHeaderNavigation
				currentSection={currentSection}
				includeSpaces={
					includeSpaces ?? (currentSection === null ? true : undefined)
				}
			/>
		) : null);

	return (
		<header
			className={cn(
				"border-foreground/10 border-b bg-background/96 backdrop-blur-sm",
				className
			)}
		>
			<div
				className={`mx-auto flex w-full flex-wrap items-center gap-4 py-3 ${APP_PAGE_FRAME_PADDING_CLASS_NAME} ${resolveAppShellFrameClassName(
					frameSection ?? currentSection ?? "start"
				)}`}
			>
				<Link
					aria-label="Go to OpenMeld homepage"
					className={cn(
						"inline-flex min-w-0 touch-manipulation items-center gap-2 max-lg:min-h-11",
						brandLinkClassName
					)}
					to="/"
				>
					<CrossPageWordmark className="transition-colors duration-200 hover:text-foreground" />
					<AppBrandStatusLabel label={brandStatusLabel} />
				</Link>

				{headerRightContent ? (
					<div
						className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2"
						data-testid="cross-page-header-right"
					>
						{headerRightContent}
					</div>
				) : null}
			</div>
		</header>
	);
}
