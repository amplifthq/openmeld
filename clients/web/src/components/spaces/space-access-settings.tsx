import type { SpaceAccessMode } from "@openmeld/schemas/types";
import { buildPublicSpaceEntryUrl } from "@openmeld/space";
import { Button } from "@openmeld/ui/components/button";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@openmeld/ui/fluid/accordion";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@openmeld/ui/fluid/select";
import { CopyIcon, GlobeIcon } from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "sonner";
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
import { SpaceVisibilityPicker } from "./space-visibility-picker";

export type SpaceAccessSettingsProps = {
	surface?: "settings" | "share";
	openMeldProfileId?: string;
	accessMode: SpaceAccessMode;
	canManageAccess: boolean;
	errorMessage: string | null;
	isPending: boolean;
	onSetAccessMode: (input: SpaceAccessUpdateInput) => Promise<void>;
	onSetVisibility?: (visibility: "public" | "private") => Promise<void>;
	spaceId: string;
	visibility?: "public" | "private";
};

/** Share uses the same access facts without exposing policy or role editors. */
export function SpaceAccessSettings(input: SpaceAccessSettingsProps) {
	const scope = useOptionalAppOrganization();
	const organization = scope?.currentOrganization;
	const generalAccessId = useId();
	const save = useMutation({
		mutationFn: async (value: "public" | "private") => {
			if (!input.onSetVisibility) {
				throw new Error(
					"Couldn't change access. Reopen settings and try again."
				);
			}
			await input.onSetVisibility(value);
		},
	});
	const everyoneLabel = organization
		? `Everyone at ${organization.name}`
		: "Everyone in the organization";
	const hasExternalAccess = input.accessMode !== "members_only";
	const organizationAudience = describeOrganizationAccess(input, everyoneLabel);
	const audience = describeLinkAccess(input.accessMode, organizationAudience);
	const isShare = input.surface === "share";

	return (
		<div className="min-w-0 space-y-4">
			{scope && isShare ? (
				<SpaceAccessInvitations
					canInviteGuests={input.canManageAccess}
					openMeldProfileId={input.openMeldProfileId}
					spaceId={input.spaceId}
				/>
			) : null}
			{!isShare && (
				<section className="grid gap-2">
					<label
						className="block font-medium text-sm"
						htmlFor={generalAccessId}
					>
						{hasExternalAccess
							? "Organization access"
							: "Who can join this Space"}
					</label>
					<SpaceVisibilityPicker
						disabled={
							!(
								input.canManageAccess &&
								input.onSetVisibility &&
								input.visibility
							) ||
							save.isPending ||
							input.isPending
						}
						id={generalAccessId}
						onChange={(value) => save.mutate(value)}
						value={input.visibility}
					/>
					<p className="text-muted-foreground text-xs/relaxed">
						{organizationAudience}
					</p>
					{input.canManageAccess ? null : (
						<p className="text-muted-foreground text-xs">
							Only Space owners can change access.
						</p>
					)}
					{save.isPending ? (
						<output className="block text-muted-foreground text-xs">
							Saving…
						</output>
					) : null}
					{save.error ? (
						<p className="text-destructive text-xs" role="alert">
							{save.error.message}
						</p>
					) : null}
				</section>
			)}
			{hasExternalAccess && !isShare ? (
				<section className="space-y-2 border-border/60 border-t pt-4">
					<div className="flex items-center gap-2 font-medium text-sm">
						<GlobeIcon aria-hidden="true" className="size-4" />
						Link access is enabled
					</div>
					<p className="text-muted-foreground text-xs/relaxed">{audience}</p>
					<Accordion>
						<AccordionItem value="link-access">
							<AccordionTrigger
								chevronClassName="motion-reduce:transition-none"
								className="py-1 text-sm"
							>
								Manage link access
							</AccordionTrigger>
							<AccordionContent className="motion-reduce:transition-none">
								<div className="pt-3">
									<SpaceAccessEditor
										accessMode={input.accessMode}
										canManageAccess={input.canManageAccess}
										errorMessage={input.errorMessage}
										isPending={input.isPending}
										key={input.accessMode}
										onSetAccessMode={input.onSetAccessMode}
									/>
								</div>
							</AccordionContent>
						</AccordionItem>
					</Accordion>
				</section>
			) : null}
			{!isShare &&
			input.canManageAccess &&
			organization &&
			!organization.isPersonal ? (
				<SpaceGuestAccessSection
					openMeldProfileId={input.openMeldProfileId}
					spaceId={input.spaceId}
					surface={isShare ? "share" : "settings"}
				/>
			) : null}
			{!isShare && (
				<SpaceOwnersSection
					canManage={input.canManageAccess}
					openMeldProfileId={input.openMeldProfileId}
					spaceId={input.spaceId}
				/>
			)}
			<section className="flex items-center justify-end gap-3 border-border/60 border-t pt-4">
				{isShare && (
					<p className="mr-auto text-muted-foreground text-xs/relaxed">
						{hasExternalAccess ? audience : "This link doesn’t change access."}
					</p>
				)}
				<Button
					onClick={async () => {
						const url = buildPublicSpaceEntryUrl({
							origin: window.location.origin,
							target: { spaceId: input.spaceId },
						});
						if (await copyTextToClipboard(url)) {
							toast.success("Space link copied.");
						} else {
							toast.error("Couldn't copy the link. Try again.");
						}
					}}
					size="sm"
					variant="outline"
				>
					<CopyIcon aria-hidden="true" />
					Copy Space link
				</Button>
			</section>
		</div>
	);
}

function describeOrganizationAccess(
	input: SpaceAccessSettingsProps,
	everyoneLabel: string
): string {
	if (!input.visibility) {
		return "Space access is currently unavailable.";
	}
	if (input.visibility === "public") {
		return `${everyoneLabel} can find and join this Space.`;
	}
	if (input.accessMode !== "members_only") {
		return "Hidden from the organization directory. Link access below still applies.";
	}
	return "Only people added to this Space can open it.";
}

function describeLinkAccess(
	accessMode: SpaceAccessMode,
	organizationAudience: string
): string {
	switch (accessMode) {
		case "public":
			return "Anyone with the link can view and join this Space.";
		case "public_view_join_password":
			return "Anyone with the link can view. People outside the organization need a password to join.";
		case "protected":
			return "People with the password can view and join this Space.";
		default:
			return organizationAudience;
	}
}

function SpaceAccessInvitations(input: {
	spaceId: string;
	canInviteGuests: boolean;
	openMeldProfileId?: string;
}) {
	const [audience, setAudience] = useState<"organization" | "guest">(
		"organization"
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
	if (scope?.currentOrganization.isPersonal) {
		return null;
	}
	if (members.isError) {
		return (
			<div className="flex items-center justify-between gap-2 text-xs">
				<span>Couldn't load invitation options.</span>
				<Button onClick={() => members.refetch()} size="sm" variant="ghost">
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
	if (!canInvite) {
		return null;
	}
	return (
		<section className="grid gap-2">
			<div className="flex items-center justify-between gap-3">
				<h3 className="font-medium text-sm">Invite people</h3>
				{input.canInviteGuests && (
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
							className="w-fit min-w-0"
							displayValue={audience === "guest" ? "Guest" : "Teammate"}
						/>
						<SelectContent>
							<SelectItem index={0} value="organization">
								Teammate
							</SelectItem>
							<SelectItem index={1} value="guest">
								Guest
							</SelectItem>
						</SelectContent>
					</Select>
				)}
			</div>
			{audience === "guest" && input.canInviteGuests ? (
				<SpaceGuestAccessSection
					openMeldProfileId={input.openMeldProfileId}
					spaceId={input.spaceId}
					surface="share"
				/>
			) : (
				<SpaceInvitationForm spaceId={input.spaceId} />
			)}
		</section>
	);
}
