import type { GetSpaceStatusResponse } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { DialogContent } from "@openmeld/ui/fluid/dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import { createUnscopedWebSpaceApi } from "#/lib/spaces/api";
import { spaceQueryKeys, spaceStatusQueryOptions } from "#/query/spaces/status";
import { SpaceInvitationForm } from "./space-invitations-section";

type SpaceGuestAccessSectionProps = {
	spaceId: string;
	openMeldProfileId?: string;
	submitButtonTarget?: HTMLElement | null;
	disabled?: boolean;
};

export function SpaceGuestAccessSection(props: SpaceGuestAccessSectionProps) {
	const scope = useOptionalAppOrganization();
	return (
		<ScopedSpaceGuestAccessSection
			{...props}
			key={JSON.stringify([
				scope?.currentUserId,
				scope?.currentOrganization.id,
				props.spaceId,
				props.openMeldProfileId,
			])}
		/>
	);
}

function ScopedSpaceGuestAccessSection({
	spaceId,
	openMeldProfileId,
	submitButtonTarget,
	disabled = false,
}: SpaceGuestAccessSectionProps) {
	const [confirm, setConfirm] = useState(false);
	const pendingInvitationRef = useRef<(() => void) | null>(null);
	useEffect(() => {
		if (disabled) {
			pendingInvitationRef.current = null;
			setConfirm(false);
		}
		return () => {
			pendingInvitationRef.current = null;
		};
	}, [disabled]);
	const client = useQueryClient();
	const status = useQuery(
		spaceStatusQueryOptions({ spaceId, openMeldProfileId, enabled: true })
	);
	const save = useMutation({
		mutationFn: (allowGuests: boolean) =>
			createUnscopedWebSpaceApi({ openMeldProfileId }).updateMeta({
				spaceId,
				allowGuests,
			}),
		onSuccess: () => {
			client
				.invalidateQueries({ queryKey: spaceQueryKeys.all })
				.catch((error) => {
					console.error("Failed to refresh Space guest access.", error);
				});
		},
	});
	return (
		<section className="grid gap-2">
			<GuestInvitationEntry
				disabled={disabled}
				enabled={status.data?.allowGuests === true}
				failed={status.isError}
				hasData={Boolean(status.data)}
				onEnable={(continueInvitation) => {
					pendingInvitationRef.current = continueInvitation;
					setConfirm(true);
				}}
				onRetry={() => status.refetch()}
				pending={status.isPending}
				spaceId={spaceId}
				submitButtonTarget={submitButtonTarget}
			/>
			<Dialog
				onOpenChange={(open) => {
					setConfirm(open);
					if (!open) {
						pendingInvitationRef.current = null;
					}
				}}
				open={confirm && status.isSuccess && !status.data.allowGuests}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Enable guest participation?</DialogTitle>
						<DialogDescription>
							{describeGuestEnableImpact(status.data)}
						</DialogDescription>
					</DialogHeader>
					{save.error ? (
						<p className="text-destructive text-xs" role="alert">
							{save.error.message}
						</p>
					) : null}
					<DialogFooter>
						<Button
							onClick={() => {
								pendingInvitationRef.current = null;
								setConfirm(false);
							}}
							variant="secondary"
						>
							Cancel
						</Button>
						<Button
							disabled={disabled || save.isPending}
							onClick={async () => {
								const continueInvitation = pendingInvitationRef.current;
								try {
									await save.mutateAsync(true);
								} catch {
									return;
								}
								if (pendingInvitationRef.current !== continueInvitation) {
									return;
								}
								pendingInvitationRef.current = null;
								setConfirm(false);
								continueInvitation?.();
							}}
						>
							Enable and invite guest
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</section>
	);
}

function describeGuestEnableImpact(status?: GetSpaceStatusResponse): string {
	const base =
		"This lets the invitation continue and restores access for previously admitted guests. Guests join only this Space, not the organization.";
	if (!status || status.linkJoinPolicy === "invite_only") {
		return base;
	}
	if (
		status.accessMode === "protected" ||
		status.accessMode === "public_view_join_password"
	) {
		return `${base} Other external users with the link can also sign in and join with the Space password.`;
	}
	return `${base} Other external users with the link can also sign in and join.`;
}

function GuestInvitationEntry(input: {
	disabled: boolean;
	hasData: boolean;
	pending: boolean;
	failed: boolean;
	enabled: boolean;
	onRetry: () => void;
	onEnable: (continueInvitation: () => void) => void;
	spaceId: string;
	submitButtonTarget?: HTMLElement | null;
}) {
	if (input.pending && !input.hasData) {
		return (
			<p className="text-muted-foreground text-xs">Checking guest access…</p>
		);
	}
	const error = input.failed ? (
		<p className="text-destructive text-xs" role="alert">
			Couldn't check guest access.{" "}
			<Button onClick={input.onRetry} size="sm" variant="secondary">
				Try again
			</Button>
		</p>
	) : null;
	if (error && !input.hasData) {
		return error;
	}
	return (
		<>
			{error}
			<SpaceInvitationForm
				actionVariant="secondary"
				audience="guest"
				disabled={input.disabled || input.failed}
				onBeforeCreate={input.enabled ? undefined : input.onEnable}
				spaceId={input.spaceId}
				submitButtonTarget={input.submitButtonTarget}
			/>
		</>
	);
}
