"use client";

import { cn } from "@openmeld/ui/lib/utils";
import type { ReactNode, Ref } from "react";

export function ProfileCard(input: {
	actions?: ReactNode;
	className?: string;
	dimTitle?: boolean;
	footerLeft?: ReactNode;
	footerRight?: ReactNode;
	icon: ReactNode;
	menu?: ReactNode;
	onProfileSummaryClick?: () => void;
	profileSummaryAriaLabel?: string;
	rowRef?: Ref<HTMLElement>;
	secondarySubtitle?: ReactNode;
	subtitle?: ReactNode;
	testId?: string;
	title: string;
	titleAction?: ReactNode;
	titleAdornment?: ReactNode;
}) {
	const {
		actions,
		className,
		dimTitle,
		footerLeft,
		footerRight,
		icon,
		menu,
		onProfileSummaryClick,
		profileSummaryAriaLabel,
		rowRef,
		secondarySubtitle,
		subtitle,
		testId,
		title,
		titleAction,
		titleAdornment,
	} = input;
	const hasFooter = Boolean(footerLeft || footerRight);
	const hasSecondarySubtitle =
		secondarySubtitle !== undefined &&
		secondarySubtitle !== null &&
		secondarySubtitle !== false;
	const summaryContent = (
		<>
			{icon}
			<div className="min-w-0 flex-1 space-y-1">
				<div className="flex min-w-0 items-center gap-2">
					<p
						className={cn(
							"min-w-0 break-words font-medium text-[0.95rem] leading-5",
							dimTitle ? "text-muted-foreground" : "text-foreground"
						)}
					>
						{title}
					</p>
					{titleAdornment ? (
						<div className="flex h-5 shrink-0 items-center">
							{titleAdornment}
						</div>
					) : null}
					{titleAction ? (
						<div className="flex h-5 shrink-0 items-center">{titleAction}</div>
					) : null}
				</div>
				{subtitle ? (
					<p className="text-muted-foreground text-xs leading-5">{subtitle}</p>
				) : null}
				{hasSecondarySubtitle ? (
					<p className="text-muted-foreground text-xs leading-5">
						{secondarySubtitle}
					</p>
				) : null}
			</div>
		</>
	);
	return (
		<article
			className={cn(
				"group flex h-full min-w-0 flex-col rounded-md border border-border/70 bg-transparent px-4 py-4 transition-[background-color,border-color,box-shadow] hover:border-border",
				className
			)}
			data-testid={testId}
			ref={rowRef}
		>
			<div className="flex min-w-0 items-start justify-between gap-3">
				{onProfileSummaryClick ? (
					<button
						aria-label={profileSummaryAriaLabel ?? `About ${title}`}
						className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 rounded-sm text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
						onClick={onProfileSummaryClick}
						type="button"
					>
						{summaryContent}
					</button>
				) : (
					<div className="flex min-w-0 flex-1 items-start gap-3">
						{summaryContent}
					</div>
				)}
				{menu ? (
					<div className="flex shrink-0 items-start justify-end">{menu}</div>
				) : null}
			</div>
			{actions ? <div className="mt-4">{actions}</div> : null}
			{hasFooter ? (
				<div className="mt-auto pt-3">
					<div className="flex min-w-0 flex-col gap-1.5 border-border/70 border-t pt-2.5 text-xs sm:flex-row sm:items-center sm:justify-between">
						{footerLeft ? (
							<div className="min-w-0 text-muted-foreground">{footerLeft}</div>
						) : null}
						{footerRight ? (
							<div className="shrink-0 sm:ml-auto">{footerRight}</div>
						) : null}
					</div>
				</div>
			) : null}
		</article>
	);
}

export function ProfileListItem(input: {
	actions?: ReactNode;
	badges?: ReactNode;
	children?: ReactNode;
	className?: string;
	dimName?: boolean;
	icon: ReactNode;
	metadataDetail?: ReactNode;
	onProfileSummaryClick?: () => void;
	profileNameAdornment?: ReactNode;
	profileNameClassName?: string;
	primaryDetail?: ReactNode;
	profileSummaryAriaLabel?: string;
	profileName: string;
	rowRef?: Ref<HTMLDivElement>;
	secondaryDetail?: ReactNode;
	testId?: string;
}) {
	const profileNameClassName = cn(
		"min-w-0 break-words font-medium text-sm sm:text-[0.95rem]",
		input.dimName ? "text-muted-foreground" : "text-foreground",
		input.profileNameClassName
	);
	const profileSummary = input.onProfileSummaryClick ? (
		<button
			aria-label={input.profileSummaryAriaLabel ?? `About ${input.profileName}`}
			className="group inline-flex min-w-0 cursor-pointer items-center gap-2 text-left transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
			onClick={input.onProfileSummaryClick}
			type="button"
		>
			{input.icon}
			<span className={profileNameClassName}>{input.profileName}</span>
		</button>
	) : (
		<>
			{input.icon}
			<p className={profileNameClassName}>{input.profileName}</p>
		</>
	);

	return (
		<div
			className={cn("flex items-start justify-between gap-3", input.className)}
			data-testid={input.testId}
			ref={input.rowRef}
		>
			<div className="min-w-0 flex-1 space-y-1.5">
				<div className="flex min-w-0 flex-wrap items-center gap-2">
					{input.profileNameAdornment ? (
						<div className="inline-flex min-w-0 items-center gap-2">
							{profileSummary}
							<div className="shrink-0">{input.profileNameAdornment}</div>
						</div>
					) : (
						profileSummary
					)}
					{input.badges}
				</div>
				{input.primaryDetail ? (
					<p className="text-muted-foreground text-xs leading-5">
						{input.primaryDetail}
					</p>
				) : null}
				{input.secondaryDetail ? (
					<p className="text-muted-foreground text-xs leading-5">
						{input.secondaryDetail}
					</p>
				) : null}
				{input.metadataDetail ? (
					<p className="text-muted-foreground text-xs leading-5">
						{input.metadataDetail}
					</p>
				) : null}
				{input.children}
			</div>
			{input.actions ? (
				<div className="flex shrink-0 items-start justify-end">
					{input.actions}
				</div>
			) : null}
		</div>
	);
}

export const AgentProfileListItem = ProfileListItem;
