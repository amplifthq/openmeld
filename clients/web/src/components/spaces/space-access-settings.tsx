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
import {
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { Input } from "@openmeld/ui/components/input";
import { Switch } from "@openmeld/ui/components/switch";
import { DialogContent } from "@openmeld/ui/fluid/dialog";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@openmeld/ui/fluid/select";
import { ArrowLeftIcon, CopyIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
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
import { SpaceOwnersSection } from "./space-owners-section";
import { resolveSpaceLinkReading } from "./space-sharing-model";
import { SpaceVisibilityPicker } from "./space-visibility-picker";
import type { SpaceSharingDraftController } from "./use-space-sharing-draft";

export type SpaceAccessSettingsProps = {
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
	const [shareView, setShareView] = useState<"main" | "invite">("main");
	const [pendingInviteChoice, setPendingInviteChoice] = useState(false);
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
	const spaceUrl = buildPublicSpaceEntryUrl({
		origin: resolveSpaceShareOrigin(),
		target: { spaceId: input.spaceId },
	});

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
		if (controller.isDirty) {
			setPendingInviteChoice(true);
			return;
		}
		setShareView("invite");
	};

	const editor = (
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
			onInvitePeople={isShare ? openInvitations : undefined}
			onPasswordChange={(password) => {
				controller.setPassword(password);
				setLocalErrorMessage(null);
			}}
			organizationName={organization?.name}
			password={controller.password}
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
		return (
			<>
				<div className="flex min-h-0 min-w-0 flex-1 flex-col">
					<ScrollArea
						className="min-h-0 min-w-0 flex-1"
						contentClassName="space-y-4 pr-1"
						data-testid="space-share-dialog-scroll-area"
						orientation="vertical"
						scrollFade={false}
					>
						{shareView === "invite" ? (
							<InviteView
								canInviteGuests={input.canManageAccess}
								onBack={() => setShareView("main")}
								openMeldProfileId={input.openMeldProfileId}
								spaceId={input.spaceId}
							/>
						) : (
							<>
								{editor}
								{warnings}
								{copyFailed ? (
									<div className="block space-y-1">
										<span className="text-muted-foreground text-xs">
											Copy the link manually
										</span>
										<Input aria-label="Space link" readOnly value={spaceUrl} />
									</div>
								) : null}
							</>
						)}
					</ScrollArea>
					{shareView === "main" ? (
						<footer className="mt-4 flex shrink-0 items-center gap-2 border-border/60 border-t pt-4">
							{input.onOpenAccessSettings ? (
								<Button
									onClick={input.onOpenAccessSettings}
									size="sm"
									type="button"
									variant="ghost"
								>
									Manage access
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
								<Button
									disabled={controller.isDirty ? saveDisabled : false}
									onClick={async () => {
										if (controller.isDirty && !(await saveAccess())) {
											return;
										}
										await copyLink();
									}}
									size="sm"
									type="button"
								>
									<CopyIcon aria-hidden="true" />
									{resolveShareActionLabel(controller.isDirty, isCommitting)}
								</Button>
							</div>
						</footer>
					) : null}
				</div>

				<Dialog
					onOpenChange={setPendingInviteChoice}
					open={pendingInviteChoice}
				>
					<DialogContent size="sm">
						<DialogHeader>
							<DialogTitle>Continue to invitations?</DialogTitle>
							<DialogDescription>
								Choose what to do with your unsaved access changes first.
							</DialogDescription>
						</DialogHeader>
						{localErrorMessage ? (
							<p className="text-destructive text-xs" role="alert">
								{localErrorMessage}
							</p>
						) : null}
						<DialogFooter className="flex-wrap">
							<Button
								onClick={() => setPendingInviteChoice(false)}
								variant="secondary"
							>
								Go back
							</Button>
							<Button
								onClick={() => {
									controller.reset();
									setPendingInviteChoice(false);
									setShareView("invite");
								}}
								variant="secondary"
							>
								Discard changes and continue
							</Button>
							<Button
								disabled={saveDisabled}
								onClick={async () => {
									if (await saveAccess()) {
										setPendingInviteChoice(false);
										setShareView("invite");
									}
								}}
							>
								{isCommitting ? "Saving…" : "Save changes and continue"}
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			</>
		);
	}

	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col">
			<div className="flex shrink-0 items-center justify-between gap-3 px-5 pt-5 sm:px-6 sm:pt-6">
				<h2 className="pr-8 font-medium text-base">Access</h2>
				{input.onOpenShare ? (
					<Button
						onClick={input.onOpenShare}
						size="sm"
						type="button"
						variant="outline"
					>
						Open Share
					</Button>
				) : null}
			</div>
			<ScrollArea
				className="min-h-0 min-w-0 flex-1"
				contentClassName="space-y-5 p-5 sm:p-6"
				orientation="vertical"
			>
				{editor}
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
				{organization && !organization.isPersonal && input.canManageAccess ? (
					<section className="grid gap-2 border-border/60 border-t pt-4">
						<div className="flex items-center justify-between gap-3">
							<label className="font-medium text-sm" htmlFor={guestSwitchId}>
								Allow external guests
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
							Public reading does not require guest access. Guests sign in and
							join only this Space.
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
				<SpaceOwnersSection
					canManage={input.canManageAccess}
					openMeldProfileId={input.openMeldProfileId}
					spaceId={input.spaceId}
				/>
			</ScrollArea>
			{input.canManageAccess ? (
				<footer className="flex shrink-0 justify-end gap-2 border-border/60 border-t px-5 py-4 sm:px-6">
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
	onBack: () => void;
	openMeldProfileId?: string;
	spaceId: string;
}) {
	return (
		<div className="space-y-4">
			<Button
				className="-ml-2 w-fit"
				onClick={input.onBack}
				size="sm"
				type="button"
				variant="ghost"
			>
				<ArrowLeftIcon aria-hidden="true" />
				Back
			</Button>
			<div>
				<h3 className="font-medium text-base">Invite to this Space</h3>
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
				/>
			) : (
				<SpaceInvitationForm
					actionVariant="secondary"
					spaceId={input.spaceId}
				/>
			)}
		</section>
	);
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
