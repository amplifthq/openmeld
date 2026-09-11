import type { GetSpaceStatusResponse } from "@openmeld/schemas/types";
import { isDirectMessageSpace } from "@openmeld/space";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { resolveStatusToneIndicatorClassName } from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import { ChatCircleTextIcon, WarningIcon } from "@phosphor-icons/react";
import { Fragment, type ReactNode, useState } from "react";
import {
	AppModuleSidebarToggle,
	useHasModuleSidebar,
} from "#/components/app/app-module-sidebar";
import type { SpaceLiveState } from "#/lib/spaces/timeline";
import { PUBLIC_SPACE_ACCESS_WARNING_TOOLTIP } from "./space-access-editor";
import {
	SpaceHeaderNavigationMenu,
	type SpaceHeaderNavigationMenuItem,
} from "./space-header-navigation-menu";
import { SpacePinsRecallAction } from "./space-pins";
import { useSpaceReadingHeader } from "./space-reading-header";
import { SpaceSettingsDialog } from "./space-settings-dialog";
import { SpaceShareDialog } from "./space-share-dialog";

export type SpaceWindowHeaderSubtitleItem = {
	key: string;
	node: ReactNode;
};

export function SpaceWindowHeader(input: {
	actions?: ReactNode;
	contentClassName?: string;
	leadingControl?: ReactNode;
	navigation?: ReactNode;
	renderFrame?: boolean;
	secondaryContentClassName?: string;
	subtitleItems?: readonly SpaceWindowHeaderSubtitleItem[];
	title: string;
	// Rendered immediately after the title, kept shrink-0 so the live-status
	// indicator stays pinned to the name while the title truncates.
	titleAdornment?: ReactNode;
}) {
	const readingHeader = useSpaceReadingHeader();
	const hasModuleSidebar = useHasModuleSidebar();
	const subtitleItems = input.subtitleItems ?? [];
	const hasSecondaryRow =
		input.navigation !== undefined || subtitleItems.length > 0;
	const content = (
		<div
			className={cn(
				"relative grid h-full w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] gap-x-3 px-[var(--app-page-inline-padding)]",
				hasSecondaryRow
					? "grid-rows-[minmax(0,var(--space-conversation-title-height))_minmax(0,var(--space-conversation-navigation-height))]"
					: "grid-rows-1",
				input.contentClassName
			)}
			ref={readingHeader?.setHeader}
		>
			{input.leadingControl || hasModuleSidebar ? (
				<div className="col-start-1 row-start-1 flex shrink-0 items-center gap-3">
					<AppModuleSidebarToggle />
					{input.leadingControl}
				</div>
			) : null}
			<div
				className="col-start-2 row-start-1 flex min-h-0 min-w-0 items-center gap-2 overflow-hidden"
				data-slot="space-window-header-title"
			>
				<h1
					className={cn(
						"truncate font-medium text-lg",
						readingHeader && "max-w-[28rem]"
					)}
					title={readingHeader ? input.title : undefined}
				>
					{input.title}
				</h1>
				{input.titleAdornment ?? null}
			</div>

			{input.actions ? (
				<div className="col-start-3 row-start-1 flex shrink-0 items-center justify-end gap-2">
					{input.actions}
				</div>
			) : null}

			{hasSecondaryRow ? (
				<div
					className={cn(
						"col-end-4 row-start-2 flex min-w-0 items-center gap-3",
						input.navigation
							? "col-start-1 -mx-2 overflow-visible px-2"
							: "col-start-2 overflow-hidden",
						input.secondaryContentClassName
					)}
					data-slot="space-window-header-secondary"
				>
					{input.navigation ? (
						<div
							className="flex h-full shrink-0 items-center"
							data-slot="space-window-header-navigation"
						>
							{input.navigation}
						</div>
					) : null}
					{subtitleItems.length > 0 ? (
						<div className="flex min-w-0 items-center gap-x-2 overflow-hidden text-muted-foreground text-xs">
							{subtitleItems.map((item, index) => (
								<Fragment key={item.key}>
									{index > 0 ? <span aria-hidden="true">·</span> : null}
									{item.node}
								</Fragment>
							))}
						</div>
					) : null}
				</div>
			) : null}
		</div>
	);

	if (input.renderFrame === false) {
		return content;
	}

	return (
		<header className="h-[var(--space-conversation-header-height)] w-full shrink-0 border-border border-b bg-background">
			{content}
		</header>
	);
}

function resolveHeaderTitle(
	conversationTitle: string | undefined,
	spaceName: string | null | undefined
) {
	return conversationTitle ?? (spaceName?.trim() || "Untitled space");
}

export function SpaceHeader(input: {
	conversationTitle?: string;
	conversationTitleAction?: (title: string) => ReactNode;
	accessModeErrorMessage: string | null;
	canManageSpaceAccess: boolean;
	canManageSpaceName: boolean;
	currentProfileName: string | null;
	currentProfileId?: string;
	deleteSpaceErrorMessage: string | null;
	directMessageOwnerVisibilityLabel?: string | null;
	hideShareControl?: boolean;
	isAccessModePending: boolean;
	isDeleteSpacePending: boolean;
	isLeaveSpacePending: boolean;
	isSpaceNamePending: boolean;
	isCenterAgentDirectMessage?: boolean;
	leaveSpaceErrorMessage: string | null;
	// Realtime stream health for this browser's live connection. Drives the
	// status dot pinned after the space name; defaults to "connected" so static
	// surfaces (e.g. the public route) render a plain live dot.
	liveErrorMessage?: string | null;
	liveState?: SpaceLiveState;
	managementControl?: ReactNode;
	menuItems?: readonly SpaceHeaderNavigationMenuItem[];
	menuLabel?: string;
	// Forces an immediate live-stream reconnect; wired to the manual retry control
	// on the degraded status indicator.
	onReconnectLiveUpdates?: () => void;
	renderFrame?: boolean;
	membersControl?: ReactNode;
	notificationControl?: ReactNode;
	// "Get set up" recall action shown before Members when the in-Space setup
	// panel is dismissed but still has actions.
	setupRecallAction?: ReactNode;
	onRecallPinnedItems?: () => void;
	viewControl?: ReactNode;
	onDeleteSpace: () => Promise<void> | void;
	onLeaveSpace?: () => Promise<void> | void;
	showDeleteSpaceAction: boolean;
	onSetAccessMode: (input: {
		accessMode: GetSpaceStatusResponse["accessMode"];
		password?: string;
	}) => Promise<void>;
	onUpdateSpaceName: (name: string) => Promise<void>;
	onSetVisibility?: (visibility: "public" | "private") => Promise<void>;
	spaceNameErrorMessage: string | null;
	status: GetSpaceStatusResponse;
}) {
	const [spaceInformationOpen, setSpaceInformationOpen] = useState(false);
	const spaceName = resolveHeaderTitle(
		input.conversationTitle,
		input.status.name
	);
	const isDirectMessage = isDirectMessageSpace({
		activeMemberCount: input.status.members.totalCount,
		directMessageConvertedAt: input.status.directMessageConvertedAt,
		purpose: input.status.spacePurpose,
	});

	return (
		<SpaceWindowHeader
			actions={
				<>
					{input.managementControl}
					{input.notificationControl}
					<div
						className="flex shrink-0 items-center gap-1"
						data-slot="space-header-primary-actions"
					>
						{input.setupRecallAction ? (
							<div
								className="max-lg:absolute max-lg:right-[var(--app-page-inline-padding)] max-lg:bottom-0 max-lg:flex max-lg:h-[var(--space-conversation-navigation-height)] max-lg:items-center"
								data-slot="space-header-setup-recall-action"
							>
								{input.setupRecallAction}
							</div>
						) : null}
						<SpacePinsRecallAction onRecall={input.onRecallPinnedItems} />
						{input.membersControl ?? null}
						{input.hideShareControl === true ? null : (
							<SpaceShareDialog
								accessMode={input.status.accessMode}
								canManageAccess={input.canManageSpaceAccess}
								errorMessage={input.accessModeErrorMessage}
								isPending={input.isAccessModePending}
								onSetAccessMode={input.onSetAccessMode}
								onSetVisibility={input.onSetVisibility}
								openMeldProfileId={input.currentProfileId}
								spaceId={input.status.spaceId}
								spaceName={spaceName}
								visibility={input.status.organizationVisibility}
							/>
						)}
						{input.menuItems ? (
							<SpaceHeaderNavigationMenu
								ariaLabel={input.menuLabel ?? "More options"}
								items={input.menuItems}
								onOpenConversationInformation={() => {
									setSpaceInformationOpen(true);
								}}
							/>
						) : null}
						<SpaceSettingsDialog
							access={{
								canManage: input.canManageSpaceAccess,
								errorMessage: input.accessModeErrorMessage,
								isPending: input.isAccessModePending,
								mode: input.status.accessMode,
								onSetMode: input.onSetAccessMode,
							}}
							currentProfileName={input.currentProfileName}
							deleteAction={{
								errorMessage: input.deleteSpaceErrorMessage,
								isPending: input.isDeleteSpacePending,
								isVisible: input.showDeleteSpaceAction,
								onDelete: input.onDeleteSpace,
							}}
							isCenterAgentDirectMessage={input.isCenterAgentDirectMessage}
							isDirectMessage={isDirectMessage}
							leaveAction={
								input.onLeaveSpace
									? {
											errorMessage: input.leaveSpaceErrorMessage,
											isPending: input.isLeaveSpacePending,
											onLeave: input.onLeaveSpace,
										}
									: undefined
							}
							name={{
								canManage: input.canManageSpaceName,
								errorMessage: input.spaceNameErrorMessage,
								isPending: input.isSpaceNamePending,
								onSave: input.onUpdateSpaceName,
								value: spaceName,
							}}
							onOpenChange={
								input.menuItems ? setSpaceInformationOpen : undefined
							}
							onSetVisibility={input.onSetVisibility}
							open={input.menuItems ? spaceInformationOpen : undefined}
							openMeldProfileId={input.currentProfileId}
							showTrigger={!input.menuItems}
							spaceId={input.status.spaceId}
							visibility={input.status.organizationVisibility}
						/>
					</div>
				</>
			}
			leadingControl={
				<SpaceHeaderIdentityIcon isDirectMessage={isDirectMessage} />
			}
			navigation={input.viewControl}
			renderFrame={input.renderFrame}
			secondaryContentClassName={cn(
				input.isCenterAgentDirectMessage && "overflow-x-auto",
				input.setupRecallAction && "max-lg:pr-12"
			)}
			title={spaceName}
			titleAdornment={
				<span className="flex shrink-0 items-center gap-2 text-muted-foreground text-xs">
					{input.conversationTitleAction?.(spaceName)}
					{input.isCenterAgentDirectMessage || isDirectMessage
						? null
						: renderSpaceAccessModeHeaderLabel(input.status)}
					<SpaceLiveStatusIndicator
						liveErrorMessage={input.liveErrorMessage ?? null}
						liveState={input.liveState ?? "connected"}
						onReconnectNow={input.onReconnectLiveUpdates}
					/>
					{input.directMessageOwnerVisibilityLabel ? (
						<span className="inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 font-normal text-[10px] leading-none">
							{input.directMessageOwnerVisibilityLabel}
						</span>
					) : null}
				</span>
			}
		/>
	);
}

export function SpaceHeaderIdentityIcon(input: { isDirectMessage: boolean }) {
	return (
		<ChatCircleTextIcon
			aria-hidden="true"
			className="size-4 text-muted-foreground"
			data-space-header-icon={
				input.isDirectMessage ? "direct-message" : "channel"
			}
			weight="regular"
		/>
	);
}

function renderSpaceAccessModeHeaderLabel(
	status: GetSpaceStatusResponse
): ReactNode {
	const { accessMode } = status;
	if (accessMode !== "public") {
		return (
			<span className="hidden sm:inline">
				{resolveSpaceAccessModeLabel(status)}
			</span>
		);
	}

	return <PublicSpaceAccessWarningLabel />;
}

function PublicSpaceAccessWarningLabel() {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<span
						aria-label="Public"
						className="inline-flex shrink-0 items-center gap-1 font-medium text-amber-600 dark:text-amber-400"
						data-testid="space-public-access-warning"
						role="img"
					>
						<WarningIcon aria-hidden="true" className="size-3.5 shrink-0" />
						<span className="hidden sm:inline">Public</span>
					</span>
				}
			/>
			<TooltipContent className="max-w-64 text-left" side="bottom">
				{PUBLIC_SPACE_ACCESS_WARNING_TOOLTIP}
			</TooltipContent>
		</Tooltip>
	);
}

function resolveSpaceAccessModeLabel(status: GetSpaceStatusResponse): string {
	switch (status.accessMode) {
		case "members_only":
			return status.organizationVisibility === "public"
				? "Open to organization"
				: "Invite only";
		case "protected":
			return "Password protected";
		case "public_view_join_password":
			return "Password to join";
		default:
			return "Public";
	}
}

// Label shown next to the amber dot while the live stream is reconnecting.
// Exported so tests assert on the same literal the component renders.
export const SPACE_LIVE_RECONNECTING_LABEL = "Reconnecting…";
export const SPACE_LIVE_STALE_LABEL = "Syncing…";

function resolveLiveStatusSrLabel(liveState: SpaceLiveState): string {
	switch (liveState) {
		case "degraded":
			return "Live updates paused, reconnecting";
		case "stale":
			return "Live updates are syncing missed messages";
		case "connecting":
			return "Connecting to live updates";
		default:
			return "Live updates active";
	}
}

function SpaceLiveStatusIndicator(input: {
	liveErrorMessage: string | null;
	liveState: SpaceLiveState;
	onReconnectNow?: () => void;
}) {
	const isDegraded = input.liveState === "degraded";
	const isStale = input.liveState === "stale";
	const needsAttention = isDegraded || isStale;
	const dotClassName = cn(
		"status-dot",
		resolveStatusToneIndicatorClassName(
			needsAttention ? "warning" : "ready",
			"solid"
		)
	);
	const srLabel = resolveLiveStatusSrLabel(input.liveState);
	// When degraded we expose a manual retry: don't make the user wait out the
	// (possibly background-throttled) backoff timer.
	const canRetry = isDegraded && input.onReconnectNow !== undefined;
	const degradedTooltip = canRetry
		? (input.liveErrorMessage ?? "Reconnecting… — click to reconnect now")
		: (input.liveErrorMessage ?? srLabel);
	const attentionTooltip = isDegraded
		? degradedTooltip
		: (input.liveErrorMessage ?? srLabel);
	// Every state gets a hover tooltip — the green/connecting dots carry no
	// visible text, so without it a sighted user has no way to read the status.
	const tooltipLabel = needsAttention ? attentionTooltip : srLabel;

	const indicatorBody = (
		<>
			<span aria-hidden="true" className={dotClassName} />
			{needsAttention ? (
				<span
					aria-hidden="true"
					className="font-normal text-amber-600 text-xs dark:text-amber-400"
				>
					{isDegraded ? SPACE_LIVE_RECONNECTING_LABEL : SPACE_LIVE_STALE_LABEL}
				</span>
			) : null}
		</>
	);

	return (
		<>
			{/* Always-present live region so screen readers hear status changes
			    (e.g. going degraded) regardless of the interactive element below. */}
			<output aria-live="polite" className="sr-only">
				{srLabel}
			</output>
			<Tooltip>
				<TooltipTrigger
					render={
						canRetry ? (
							<button
								aria-label="Reconnect live updates now"
								className="flex shrink-0 cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-inherit"
								data-testid="space-live-status"
								onClick={input.onReconnectNow}
								type="button"
							>
								{indicatorBody}
							</button>
						) : (
							<span
								className="flex shrink-0 items-center gap-1.5"
								data-testid="space-live-status"
							>
								{indicatorBody}
							</span>
						)
					}
				/>
				<TooltipContent side="bottom">{tooltipLabel}</TooltipContent>
			</Tooltip>
		</>
	);
}
