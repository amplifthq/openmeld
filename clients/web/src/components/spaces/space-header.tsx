import type { GetSpaceStatusResponse } from "@openmeld/schemas/types";
import { isDirectMessageSpace } from "@openmeld/space";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import {
	Tooltip,
	TooltipContent,
	TooltipHint,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { DialogContent } from "@openmeld/ui/fluid/dialog";
import { cn } from "@openmeld/ui/lib/utils";
import { ChatCircleTextIcon, WarningIcon } from "@phosphor-icons/react";
import { Fragment, type ReactNode, useState } from "react";
import {
	AppModuleSidebarToggle,
	useHasModuleSidebar,
} from "#/components/app/app-module-sidebar";
import { MessageSearchButton } from "#/components/search/message-search";
import { type ChatArchiveKind, ChatHeaderMenu } from "./chat-header-menu";
import { useConversationNames } from "./conversation-names";
import { PUBLIC_SPACE_ACCESS_WARNING_TOOLTIP } from "./space-access-editor";
import { SpaceDeletedLabel } from "./space-deleted-label";
import { SpaceHeaderNavigationMenu } from "./space-header-navigation-menu";
import { SpacePinsRecallAction } from "./space-pins";
import { useSpaceReadingHeader } from "./space-reading-header";
import { SpaceSettingsDialog } from "./space-settings-dialog";
import { SpaceShareDialog } from "./space-share-dialog";
import { useSpaceSharingDraft } from "./use-space-sharing-draft";

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
	titleControl?: ReactNode;
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
				"group/space-header relative grid h-full w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] gap-x-1 px-[var(--app-page-inline-padding)] pr-4 data-[compact=true]:grid-cols-[auto_auto_minmax(0,1fr)_auto] data-[compact=true]:grid-rows-[var(--space-conversation-title-height)]",
				hasSecondaryRow
					? "grid-rows-[minmax(0,var(--space-conversation-title-height))_minmax(0,var(--space-conversation-navigation-height))]"
					: "grid-rows-1",
				input.contentClassName
			)}
			data-has-leading-control={Boolean(input.leadingControl)}
			data-slot="space-window-header"
			ref={readingHeader?.setHeader}
		>
			{input.leadingControl || hasModuleSidebar ? (
				<div
					className="col-start-1 row-start-1 flex shrink-0 items-center gap-3"
					data-slot="space-window-header-leading"
				>
					<AppModuleSidebarToggle />
					{input.leadingControl}
				</div>
			) : null}
			<div
				className={cn(
					"col-start-2 row-start-1 flex min-h-0 min-w-0 items-center gap-2 overflow-hidden data-[has-title-control=true]:overflow-visible group-data-[compact=true]/space-header:col-span-1 group-data-[compact=true]/space-header:col-start-3 group-data-[compact=true]/space-header:my-auto group-data-[compact=true]/space-header:border-l group-data-[compact=true]/space-header:pl-3",
					!(input.leadingControl || hasModuleSidebar) &&
						"col-span-2 col-start-1"
				)}
				data-has-title-control={Boolean(input.titleControl)}
				data-slot="space-window-header-title"
			>
				{input.titleControl ?? (
					<TooltipHint content={readingHeader ? input.title : undefined}>
						<h1
							className={cn(
								"truncate font-medium text-lg",
								readingHeader && "max-w-[28rem]"
							)}
						>
							{input.title}
						</h1>
					</TooltipHint>
				)}
				{input.titleAdornment ?? null}
			</div>

			{input.actions ? (
				<div
					className="col-start-3 row-start-1 flex shrink-0 items-center justify-end gap-2 group-data-[compact=true]/space-header:col-start-4"
					data-slot="space-window-header-actions"
				>
					{input.actions}
				</div>
			) : null}

			{hasSecondaryRow ? (
				<div
					className={cn(
						"col-end-4 row-start-2 flex min-w-0 items-center gap-3 group-data-[compact=true]/space-header:contents",
						input.navigation
							? "col-start-1 -mx-2 overflow-visible px-2"
							: "col-start-2 overflow-hidden",
						input.secondaryContentClassName
					)}
					data-slot="space-window-header-secondary"
				>
					{input.navigation ? (
						<div
							className="-mx-2 flex h-full shrink-0 items-center px-2 group-data-[compact=true]/space-header:col-start-2 group-data-[compact=true]/space-header:row-start-1 group-data-[compact=true]/space-header:mx-0"
							data-slot="space-window-header-navigation"
						>
							{input.navigation}
						</div>
					) : null}
					{subtitleItems.length > 0 ? (
						<div className="flex min-w-0 items-center gap-x-2 overflow-hidden text-muted-foreground text-xs group-data-[compact=true]/space-header:hidden">
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

function ConversationHeaderMenu(input: {
	profileId?: string;
	spaceId: string;
	isDirectMessage: boolean;
	isCenterAgent?: boolean;
	onOpenSettings: () => void;
	chatArchiveKind?: ChatArchiveKind;
}) {
	const ariaLabel = input.isCenterAgent ? "Center Agent menu" : "Chat menu";
	if (input.isDirectMessage && input.profileId) {
		return (
			<ChatHeaderMenu
				archiveKind={input.chatArchiveKind}
				ariaLabel={ariaLabel}
				onOpenConversationInformation={input.onOpenSettings}
				spaceId={input.spaceId}
			/>
		);
	}
	return (
		<SpaceHeaderNavigationMenu
			ariaLabel={ariaLabel}
			items={[]}
			onOpenConversationInformation={input.onOpenSettings}
		/>
	);
}

export function SpaceHeader(input: {
	conversationTitle?: string;
	conversationTitleAction?: (title: string) => ReactNode;
	conversationTitleControl?: (title: string) => ReactNode;
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
	/** "session" archives a MemberAgent Session through Core instead. */
	chatArchiveKind?: ChatArchiveKind;
	leaveSpaceErrorMessage: string | null;
	managementControl?: ReactNode;
	showChatSettingsMenu?: boolean;
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
		linkJoinPolicy?: GetSpaceStatusResponse["linkJoinPolicy"];
		password?: string;
	}) => Promise<void>;
	onUpdateSpaceName: (name: string) => Promise<void>;
	spaceNameErrorMessage: string | null;
	status: GetSpaceStatusResponse;
}) {
	const [activeDialog, setActiveDialog] = useState<"settings" | "share" | null>(
		null
	);
	const [settingsInitialSection, setSettingsInitialSection] = useState<
		"access" | "general" | "members"
	>("general");
	const [shareInitialView, setShareInitialView] = useState<"invite" | "main">(
		"main"
	);
	const [isConfirmingDraftClose, setIsConfirmingDraftClose] = useState(false);
	const conversationNames = useConversationNames();
	const sharingDraft = useSpaceSharingDraft({
		accessMode: input.status.accessMode,
		allowGuests: input.status.allowGuests,
		linkJoinPolicy: input.status.linkJoinPolicy,
		spaceId: input.status.spaceId,
		visibility: input.status.organizationVisibility,
	});
	const isDirectMessage = isDirectMessageSpace({
		directMessageConvertedAt: input.status.directMessageConvertedAt,
		purpose: input.status.spacePurpose,
	});
	const spaceName = resolveHeaderTitle(
		input.conversationTitle ??
			(isDirectMessage
				? conversationNames?.names.get(input.status.spaceId)?.name
				: undefined),
		input.status.name
	);
	const showChatMenu = input.showChatSettingsMenu || isDirectMessage;
	const handleDialogOpenChange = (
		dialog: "settings" | "share",
		open: boolean
	) => {
		if (open) {
			setActiveDialog(dialog);
			return;
		}
		if (sharingDraft.isDirty) {
			setIsConfirmingDraftClose(true);
			return;
		}
		setActiveDialog(null);
	};

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
								className="max-lg:absolute max-lg:right-4 max-lg:bottom-0 max-lg:flex max-lg:h-[var(--space-conversation-navigation-height)] max-lg:items-center"
								data-slot="space-header-setup-recall-action"
							>
								{input.setupRecallAction}
							</div>
						) : null}
						<SpacePinsRecallAction onRecall={input.onRecallPinnedItems} />
						<MessageSearchButton
							profileId={input.currentProfileId}
							spaceId={input.status.spaceId}
						/>
						{input.membersControl ?? null}
						{input.hideShareControl === true ? null : (
							<SpaceShareDialog
								accessMode={input.status.accessMode}
								allowGuests={input.status.allowGuests}
								canManageAccess={input.canManageSpaceAccess}
								draftController={sharingDraft}
								errorMessage={input.accessModeErrorMessage}
								initialShareView={shareInitialView}
								isPending={input.isAccessModePending}
								linkJoinPolicy={input.status.linkJoinPolicy}
								onOpenAccessSettings={() => {
									setSettingsInitialSection("access");
									setActiveDialog("settings");
								}}
								onOpenChange={(open) => {
									if (open) {
										setShareInitialView("main");
									}
									handleDialogOpenChange("share", open);
								}}
								onSetAccessMode={input.onSetAccessMode}
								open={activeDialog === "share"}
								openMeldProfileId={input.currentProfileId}
								spaceId={input.status.spaceId}
								spaceName={spaceName}
								visibility={input.status.organizationVisibility}
							/>
						)}
						{showChatMenu ? (
							<ConversationHeaderMenu
								chatArchiveKind={input.chatArchiveKind}
								isCenterAgent={input.isCenterAgentDirectMessage}
								isDirectMessage={isDirectMessage}
								onOpenSettings={() => {
									setSettingsInitialSection("general");
									setActiveDialog("settings");
								}}
								profileId={input.currentProfileId}
								spaceId={input.status.spaceId}
							/>
						) : null}
						<SpaceSettingsDialog
							access={{
								allowGuests: input.status.allowGuests,
								canManage: input.canManageSpaceAccess,
								errorMessage: input.accessModeErrorMessage,
								isPending: input.isAccessModePending,
								linkJoinPolicy: input.status.linkJoinPolicy,
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
							deleted={Boolean(input.status.deletedAt)}
							draftController={sharingDraft}
							initialSection={settingsInitialSection}
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
							onOpenChange={(open) => handleDialogOpenChange("settings", open)}
							onOpenInvitations={
								input.status.deletedAt
									? undefined
									: () => {
											setShareInitialView(
												sharingDraft.isDirty ? "main" : "invite"
											);
											setActiveDialog("share");
										}
							}
							onOpenShare={
								input.status.deletedAt
									? undefined
									: () => {
											setShareInitialView("main");
											setActiveDialog("share");
										}
							}
							open={activeDialog === "settings"}
							openMeldProfileId={input.currentProfileId}
							showTrigger={!showChatMenu}
							spaceId={input.status.spaceId}
							visibility={input.status.organizationVisibility}
						/>
						<Dialog
							onOpenChange={setIsConfirmingDraftClose}
							open={isConfirmingDraftClose}
						>
							<DialogContent size="sm">
								<DialogHeader>
									<DialogTitle>Discard unsaved access changes?</DialogTitle>
									<DialogDescription>
										Your changes have not been applied to this Space.
									</DialogDescription>
								</DialogHeader>
								<DialogFooter>
									<Button
										onClick={() => setIsConfirmingDraftClose(false)}
										variant="secondary"
									>
										Keep editing
									</Button>
									<Button
										onClick={() => {
											sharingDraft.reset();
											setIsConfirmingDraftClose(false);
											setActiveDialog(null);
										}}
										variant="destructive"
									>
										Discard changes
									</Button>
								</DialogFooter>
							</DialogContent>
						</Dialog>
					</div>
				</>
			}
			leadingControl={
				isDirectMessage && !input.isCenterAgentDirectMessage ? (
					<SpaceHeaderIdentityIcon isDirectMessage />
				) : undefined
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
					{input.status.deletedAt && <SpaceDeletedLabel />}
					{!input.conversationTitleControl &&
						input.conversationTitleAction?.(spaceName)}
					{input.isCenterAgentDirectMessage || isDirectMessage
						? null
						: renderSpaceAccessModeHeaderLabel(input.status)}
					{input.directMessageOwnerVisibilityLabel ? (
						<span className="inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 font-normal text-[10px] leading-none">
							{input.directMessageOwnerVisibilityLabel}
						</span>
					) : null}
				</span>
			}
			titleControl={input.conversationTitleControl?.(spaceName)}
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
