import {
	normalizeSpacePasswordText,
	spaceAccessModeUsesPassword,
} from "@openmeld/schemas";
import type {
	SpaceAccessMode,
	SpaceLinkJoinPolicy,
} from "@openmeld/schemas/types";
import { buildPublicSpaceEntryUrl } from "@openmeld/space";
import { Button } from "@openmeld/ui/components/button";
import { Input } from "@openmeld/ui/components/input";
import { Switch } from "@openmeld/ui/components/switch";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@openmeld/ui/fluid/select";
import { TabsSubtle, TabsSubtleItem } from "@openmeld/ui/fluid/tabs-subtle";
import { CopyIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { env } from "#/env";
import { copyTextToClipboard } from "#/lib/clipboard";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import { spaceMembersQueryOptions } from "#/query/spaces/members";
import {
	SpaceAccessEditor,
	type SpaceAccessUpdateInput,
} from "./space-access-editor";
import { SpaceGuestAccessSection } from "./space-guest-access-section";
import { SpaceInvitationForm } from "./space-invitations-section";
import {
	describeSpaceJoining,
	resolveSpaceLinkJoining,
	resolveSpaceLinkReading,
	setSpaceLinkReading,
} from "./space-sharing-model";
import { SpaceVisibilityPicker } from "./space-visibility-picker";
import type { SpaceSharingDraftController } from "./use-space-sharing-draft";

export type SpaceAccessSettingsProps = {
	initialShareView?: "invite" | "main";
	surface?: "settings" | "share";
	openMeldProfileId?: string;
	accessMode: SpaceAccessMode;
	allowGuests?: boolean;
	canManageAccess: boolean;
	draftController: SpaceSharingDraftController;
	errorMessage: string | null;
	isPending: boolean;
	linkJoinPolicy?: SpaceLinkJoinPolicy;
	onOpenAccessSettings?: () => void;
	onOpenInvitations?: () => void;
	onOpenShare?: () => void;
	onSetAccessMode: (input: SpaceAccessUpdateInput) => Promise<void>;
	spaceId: string;
	visibility?: "public" | "private";
};

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: this component coordinates one draft across save, copy, invitation, and surface handoff outcomes.
export function SpaceAccessSettings(input: SpaceAccessSettingsProps) {
	const scope = useOptionalAppOrganization();
	const organization = scope?.currentOrganization;
	const guestSwitchId = useId();
	const [isCommitting, setIsCommitting] = useState(false);
	const commitInFlightRef = useRef(false);
	const [localErrorMessage, setLocalErrorMessage] = useState<string | null>(
		null
	);
	const [copyFailed, setCopyFailed] = useState(false);
	const [shareView, setShareView] = useState<"link" | "invite">(
		input.initialShareView === "invite" ? "invite" : "link"
	);
	const [inviteSubmitTarget, setInviteSubmitTarget] =
		useState<HTMLDivElement | null>(null);
	const controller = input.draftController;
	const normalizedPassword = normalizeSpacePasswordText(controller.password);
	const hasPasswordChange = normalizedPassword.length > 0;
	const mustSetPassword =
		spaceAccessModeUsesPassword(controller.draft.accessMode) &&
		!spaceAccessModeUsesPassword(input.accessMode);
	const saveDisabled =
		input.isPending ||
		isCommitting ||
		!controller.isDirty ||
		(mustSetPassword && !hasPasswordChange);
	const isShare = input.surface === "share";
	const shareHasHiddenChanges =
		controller.draft.allowGuests !== controller.baseline.allowGuests ||
		controller.draft.visibility !== controller.baseline.visibility ||
		resolveSpaceLinkJoining(controller.draft) !==
			resolveSpaceLinkJoining(controller.baseline);
	const shareReadingIsDirty =
		resolveSpaceLinkReading(controller.draft) !==
			resolveSpaceLinkReading(controller.baseline) ||
		(normalizedPassword.length > 0 &&
			resolveSpaceLinkReading(controller.draft) === "password");
	const spaceUrl = buildPublicSpaceEntryUrl({
		origin: resolveSpaceShareOrigin(),
		target: { spaceId: input.spaceId },
	});

	useEffect(() => {
		if (isShare) {
			setShareView(input.initialShareView === "invite" ? "invite" : "link");
		}
	}, [input.initialShareView, isShare]);

	const saveAccess = async (): Promise<boolean> => {
		if (saveDisabled || commitInFlightRef.current) {
			return false;
		}
		commitInFlightRef.current = true;
		setIsCommitting(true);
		setLocalErrorMessage(null);
		try {
			await input.onSetAccessMode({
				accessMode: controller.draft.accessMode,
				allowGuests: controller.draft.allowGuests,
				linkJoinPolicy: controller.draft.linkJoinPolicy,
				...(hasPasswordChange ? { password: normalizedPassword } : {}),
				visibility: controller.draft.visibility,
			});
			controller.acceptSaved(controller.draft);
			return true;
		} catch (error: unknown) {
			setLocalErrorMessage(
				error instanceof Error
					? error.message
					: "Unable to save access settings. Try again."
			);
			return false;
		} finally {
			commitInFlightRef.current = false;
			setIsCommitting(false);
		}
	};

	const saveReadingAccess = async (): Promise<boolean> => {
		if (
			shareHasHiddenChanges ||
			!shareReadingIsDirty ||
			input.isPending ||
			isCommitting ||
			commitInFlightRef.current
		) {
			return false;
		}
		const readingDraft = setSpaceLinkReading(
			controller.baseline,
			resolveSpaceLinkReading(controller.draft)
		);
		const readingNeedsPassword =
			resolveSpaceLinkReading(readingDraft) === "password" &&
			!spaceAccessModeUsesPassword(input.accessMode);
		if (readingNeedsPassword && !hasPasswordChange) {
			return false;
		}
		commitInFlightRef.current = true;
		setIsCommitting(true);
		setLocalErrorMessage(null);
		try {
			await input.onSetAccessMode({
				accessMode: readingDraft.accessMode,
				allowGuests: controller.baseline.allowGuests,
				linkJoinPolicy: readingDraft.linkJoinPolicy,
				...(hasPasswordChange ? { password: normalizedPassword } : {}),
				visibility: controller.baseline.visibility,
			});
			controller.acceptSaved(readingDraft);
			return true;
		} catch (error: unknown) {
			setLocalErrorMessage(
				error instanceof Error
					? error.message
					: "Unable to save sharing settings. Try again."
			);
			return false;
		} finally {
			commitInFlightRef.current = false;
			setIsCommitting(false);
		}
	};

	const copyLink = async () => {
		if (await copyTextToClipboard(spaceUrl)) {
			setCopyFailed(false);
			toast.success("Space link copied.");
			return;
		}
		setCopyFailed(true);
		toast.error(
			"The access settings were saved, but the link could not be copied."
		);
	};

	const openInvitations = () => {
		setShareView("invite");
	};

	const renderEditor = (section: "joining" | "reading") => (
		<SpaceAccessEditor
			canManageAccess={input.canManageAccess}
			currentAccessMode={input.accessMode}
			disabled={input.isPending || isCommitting}
			draft={controller.draft}
			errorMessage={localErrorMessage ?? input.errorMessage}
			onDraftChange={(draft) => {
				controller.setDraft(draft);
				controller.setPassword("");
				setLocalErrorMessage(null);
			}}
			onInvitePeople={
				isShare && input.canManageAccess ? openInvitations : undefined
			}
			onPasswordChange={(password) => {
				controller.setPassword(password);
				setLocalErrorMessage(null);
			}}
			organizationName={organization?.name}
			password={controller.password}
			section={section}
			surface={isShare ? "share" : "settings"}
		/>
	);

	const warnings = (
		<>
			{resolveSpaceLinkReading(controller.baseline) === "restricted" &&
			resolveSpaceLinkReading(controller.draft) !== "restricted" ? (
				<p className="text-amber-700 text-xs/relaxed dark:text-amber-300">
					After saving, existing and future messages, Threads, files, and shared
					Space context will be available to the selected link audience.
				</p>
			) : null}
			{spaceAccessModeUsesPassword(input.accessMode) &&
			!spaceAccessModeUsesPassword(controller.draft.accessMode) ? (
				<p className="text-muted-foreground text-xs/relaxed">
					Saving removes the current Space password because the new policy no
					longer uses it.
				</p>
			) : null}
		</>
	);

	if (isShare) {
		const shareSaveDisabled =
			shareHasHiddenChanges ||
			input.isPending ||
			isCommitting ||
			(mustSetPassword && !hasPasswordChange);
		return (
			<div className="flex min-h-0 min-w-0 flex-1 flex-col">
				<TabsSubtle
					aria-label="Share or invite"
					className="mb-5 w-fit shrink-0"
					idPrefix="space-share-tabs"
					onSelect={(index) => setShareView(index === 1 ? "invite" : "link")}
					selectedIndex={shareView === "invite" ? 1 : 0}
				>
					<TabsSubtleItem className="h-8" index={0} label="Share link" />
					<TabsSubtleItem className="h-8" index={1} label="Invite people" />
				</TabsSubtle>
				<ScrollArea
					className="min-h-0 min-w-0 flex-1"
					contentClassName="space-y-4 pr-1"
					data-testid="space-share-dialog-scroll-area"
					orientation="vertical"
					scrollFade={false}
				>
					<div
						aria-labelledby="space-share-tabs-tab-0"
						hidden={shareView !== "link"}
						id="space-share-tabs-panel-0"
						role="tabpanel"
					>
						{renderEditor("reading")}
						{warnings}
						{shareHasHiddenChanges ? (
							<p className="text-muted-foreground text-xs/relaxed">
								Finish the pending access changes in Access settings before
								changing link sharing.
							</p>
						) : null}
						{resolveSpaceLinkJoining(controller.baseline) !== "invite_only" ? (
							<div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2 text-xs">
								<span>
									{describeSavedJoining(
										controller.baseline,
										organization?.name
									)}
								</span>
								{input.onOpenAccessSettings ? (
									<Button
										onClick={input.onOpenAccessSettings}
										size="xs"
										type="button"
										variant="secondary"
									>
										Manage
									</Button>
								) : null}
							</div>
						) : null}
						{copyFailed ? (
							<div className="block space-y-1">
								<span className="text-muted-foreground text-xs">
									Copy the link manually
								</span>
								<Input aria-label="Space link" readOnly value={spaceUrl} />
							</div>
						) : null}
					</div>
					<div
						aria-labelledby="space-share-tabs-tab-1"
						hidden={shareView !== "invite"}
						id="space-share-tabs-panel-1"
						role="tabpanel"
					>
						<InviteView
							canInviteGuests={input.canManageAccess}
							openMeldProfileId={input.openMeldProfileId}
							spaceId={input.spaceId}
							submitButtonTarget={inviteSubmitTarget}
						/>
					</div>
				</ScrollArea>
				{shareView === "link" ? (
					<footer className="mt-4 flex shrink-0 items-center gap-2 border-border/60 border-t pt-4">
						{input.onOpenAccessSettings ? (
							<Button
								onClick={input.onOpenAccessSettings}
								size="sm"
								type="button"
								variant="secondary"
							>
								Manage access
							</Button>
						) : null}
						<div className="ml-auto flex items-center gap-2">
							{shareReadingIsDirty && !shareHasHiddenChanges ? (
								<Button
									disabled={input.isPending || isCommitting}
									onClick={controller.reset}
									size="sm"
									type="button"
									variant="ghost"
								>
									Discard changes
								</Button>
							) : null}
							<Button
								disabled={shareReadingIsDirty ? shareSaveDisabled : false}
								onClick={async () => {
									if (shareReadingIsDirty && !(await saveReadingAccess())) {
										return;
									}
									await copyLink();
								}}
								size="sm"
								type="button"
							>
								<CopyIcon aria-hidden="true" />
								{resolveShareActionLabel(shareReadingIsDirty, isCommitting)}
							</Button>
						</div>
					</footer>
				) : (
					<footer className="mt-4 flex shrink-0 justify-end border-border/60 border-t pt-4">
						<div ref={setInviteSubmitTarget} />
					</footer>
				)}
			</div>
		);
	}

	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col">
			<div className="flex shrink-0 items-center px-5 pt-5 sm:px-6 sm:pt-6">
				<h2 className="pr-8 font-medium text-base">Share &amp; Access</h2>
			</div>
			<ScrollArea
				className="min-h-0 min-w-0 flex-1"
				contentClassName="space-y-5 p-5 sm:p-6"
				orientation="vertical"
			>
				{renderEditor("reading")}
				{input.visibility ? (
					<OrganizationAccessSection
						disabled={!input.canManageAccess || input.isPending || isCommitting}
						id={`${guestSwitchId}-organization`}
						onChange={(visibility) =>
							controller.setDraft({ ...controller.draft, visibility })
						}
						organizationName={organization?.name}
						value={controller.draft.visibility}
					/>
				) : null}
				{renderEditor("joining")}
				{organization && !organization.isPersonal && input.canManageAccess ? (
					<section className="grid gap-2 border-border/60 border-t pt-4">
						<div className="flex items-center justify-between gap-3">
							<label className="font-medium text-sm" htmlFor={guestSwitchId}>
								Guest participation
							</label>
							<Switch
								checked={controller.draft.allowGuests}
								disabled={input.isPending || isCommitting}
								id={guestSwitchId}
								onCheckedChange={(allowGuests) =>
									controller.setDraft({ ...controller.draft, allowGuests })
								}
							/>
						</div>
						<p className="text-muted-foreground text-xs/relaxed">
							{controller.draft.allowGuests
								? "Guests join only this Space, not the organization."
								: "External guests cannot join or participate. Link-based reading is unchanged."}
						</p>
						{controller.draft.allowGuests ? (
							<p className="text-muted-foreground text-xs/relaxed">
								Turning this off blocks existing guests. Turning it back on may
								restore their access.
							</p>
						) : null}
					</section>
				) : null}
				{warnings}
			</ScrollArea>
			{input.canManageAccess || input.onOpenShare ? (
				<footer className="flex shrink-0 items-center gap-2 border-border/60 border-t px-5 py-4 sm:px-6">
					{input.onOpenShare ? (
						<Button
							onClick={input.onOpenShare}
							size="sm"
							type="button"
							variant="secondary"
						>
							Share this Space
						</Button>
					) : null}
					<div className="ml-auto flex items-center gap-2">
						{controller.isDirty ? (
							<Button
								disabled={input.isPending || isCommitting}
								onClick={controller.reset}
								size="sm"
								type="button"
								variant="ghost"
							>
								Discard changes
							</Button>
						) : null}
						{input.canManageAccess ? (
							<Button
								disabled={saveDisabled}
								onClick={() => {
									saveAccess().catch((error) =>
										console.error("Failed to update Space access.", error)
									);
								}}
								size="sm"
								type="button"
							>
								{isCommitting ? "Saving…" : "Save changes"}
							</Button>
						) : null}
					</div>
				</footer>
			) : null}
		</div>
	);
}

function OrganizationAccessSection(input: {
	disabled: boolean;
	id: string;
	onChange: (value: "public" | "private") => void;
	organizationName?: string;
	value: "public" | "private";
}) {
	return (
		<section className="grid gap-2 border-border/60 border-t pt-4">
			<div className="space-y-0.5">
				<h3 className="font-medium text-sm">Organization access</h3>
				<p className="text-muted-foreground text-xs/relaxed">
					Choose who at {input.organizationName ?? "your organization"} can find
					and join this Space.
				</p>
			</div>
			<SpaceVisibilityPicker
				disabled={input.disabled}
				id={input.id}
				onChange={input.onChange}
				value={input.value}
			/>
		</section>
	);
}

function InviteView(input: {
	canInviteGuests: boolean;
	openMeldProfileId?: string;
	spaceId: string;
	submitButtonTarget?: HTMLElement | null;
}) {
	return (
		<div className="space-y-4">
			<div>
				<h3 className="font-medium text-base">
					Invite people to join this Space
				</h3>
				<p className="text-muted-foreground text-xs/relaxed">
					Guests join only this Space. Teammates join the organization and this
					Space.
				</p>
			</div>
			<SpaceAccessInvitations {...input} />
		</div>
	);
}

function SpaceAccessInvitations(input: {
	spaceId: string;
	canInviteGuests: boolean;
	openMeldProfileId?: string;
	submitButtonTarget?: HTMLElement | null;
}) {
	const [audience, setAudience] = useState<"organization" | "guest">(
		input.canInviteGuests ? "guest" : "organization"
	);
	const scope = useOptionalAppOrganization();
	const members = useQuery(
		spaceMembersQueryOptions({
			spaceId: input.spaceId,
			enabled: Boolean(
				scope?.currentOrganization && !scope.currentOrganization.isPersonal
			),
		})
	);
	const canInvite = [
		...(members.data?.humans ?? []),
		...(members.data?.agents ?? []),
	].some(
		(person) =>
			person.status === "active" && person.ownerUserId === scope?.currentUserId
	);
	if (scope?.currentOrganization.isPersonal || !canInvite) {
		return null;
	}
	if (members.isError) {
		return (
			<div className="flex items-center justify-between gap-2 text-xs">
				<span>Unable to load invitation options.</span>
				<Button onClick={() => members.refetch()} size="sm" variant="secondary">
					Try again
				</Button>
			</div>
		);
	}
	if (members.isPending) {
		return (
			<p className="text-muted-foreground text-xs">
				Loading invitation options…
			</p>
		);
	}
	return (
		<section className="grid gap-3">
			<Select
				onValueChange={(value) => {
					if (value === "organization" || value === "guest") {
						setAudience(value);
					}
				}}
				value={audience}
			>
				<SelectTrigger
					aria-label="Invite as"
					className="w-full"
					displayValue={
						audience === "guest"
							? "Guest — this Space only"
							: "Teammate — organization and this Space"
					}
				/>
				<SelectContent matchTriggerWidth>
					{input.canInviteGuests ? (
						<SelectItem index={0} value="guest">
							Guest — this Space only
						</SelectItem>
					) : null}
					<SelectItem index={1} value="organization">
						Teammate — organization and this Space
					</SelectItem>
				</SelectContent>
			</Select>
			{audience === "guest" && input.canInviteGuests ? (
				<SpaceGuestAccessSection
					openMeldProfileId={input.openMeldProfileId}
					spaceId={input.spaceId}
					submitButtonTarget={input.submitButtonTarget}
				/>
			) : (
				<SpaceInvitationForm
					actionVariant="secondary"
					spaceId={input.spaceId}
					submitButtonTarget={input.submitButtonTarget}
				/>
			)}
		</section>
	);
}

function describeSavedJoining(
	draft: SpaceSharingDraftController["baseline"],
	organizationName?: string
): string {
	const joining = describeSpaceJoining({ draft, organizationName });
	if (joining.label === "Anyone, including external guests") {
		return "Anyone, including external guests, can also join from the link.";
	}
	if (joining.label === "Anyone with the password, including guests") {
		return "Anyone with the password, including guests, can also join from the link.";
	}
	return `${joining.label} can also join from the link.`;
}

function resolveShareActionLabel(
	isDirty: boolean,
	isCommitting: boolean
): string {
	if (isCommitting) {
		return "Saving…";
	}
	return isDirty ? "Save and copy link" : "Copy link";
}

function resolveSpaceShareOrigin(): string {
	const currentUrl = new URL(window.location.href);
	if (currentUrl.protocol === "http:" || currentUrl.protocol === "https:") {
		return currentUrl.origin;
	}
	const configuredUrl = env.VITE_BETTER_AUTH_URL;
	if (configuredUrl) {
		const parsed = new URL(configuredUrl);
		if (parsed.protocol === "http:" || parsed.protocol === "https:") {
			return parsed.origin;
		}
	}
	return "https://openmeld.ai";
}
