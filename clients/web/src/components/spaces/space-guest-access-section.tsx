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
import { useRef, useState } from "react";
import { createUnscopedWebSpaceApi } from "#/lib/spaces/api";
import { spaceQueryKeys, spaceStatusQueryOptions } from "#/query/spaces/status";
import { SpaceInvitationForm } from "./space-invitations-section";

export function SpaceGuestAccessSection({
	spaceId,
	openMeldProfileId,
}: {
	spaceId: string;
	openMeldProfileId?: string;
}) {
	const [confirm, setConfirm] = useState(false);
	const pendingInvitationRef = useRef<(() => void) | null>(null);
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
				enabled={status.data?.allowGuests === true}
				failed={status.isError}
				onEnable={(continueInvitation) => {
					pendingInvitationRef.current = continueInvitation;
					setConfirm(true);
				}}
				onRetry={() => status.refetch()}
				pending={status.isPending}
				spaceId={spaceId}
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
						<DialogTitle>Allow guest access?</DialogTitle>
						<DialogDescription>
							Guests can read this Space’s history and files, post messages, and
							use its Agents. They must sign in and won’t join your
							organization. Only enable access to content and Agents you intend
							to share. Previously admitted guests will regain access too.
						</DialogDescription>
					</DialogHeader>
					{save.error ? (
						<p className="text-destructive text-xs" role="alert">
							{save.error.message}
						</p>
					) : null}
					<DialogFooter>
						<Button onClick={() => setConfirm(false)} variant="secondary">
							Cancel
						</Button>
						<Button
							disabled={save.isPending}
							onClick={async () => {
								const continueInvitation = pendingInvitationRef.current;
								try {
									await save.mutateAsync(true);
								} catch {
									return;
								}
								pendingInvitationRef.current = null;
								setConfirm(false);
								continueInvitation?.();
							}}
						>
							Allow and invite guest
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</section>
	);
}

function GuestInvitationEntry(input: {
	pending: boolean;
	failed: boolean;
	enabled: boolean;
	onRetry: () => void;
	onEnable: (continueInvitation: () => void) => void;
	spaceId: string;
}) {
	if (input.pending) {
		return (
			<p className="text-muted-foreground text-xs">Checking guest access…</p>
		);
	}
	if (input.failed) {
		return (
			<p className="text-destructive text-xs" role="alert">
				Couldn't check guest access.{" "}
				<Button onClick={input.onRetry} size="sm" variant="secondary">
					Try again
				</Button>
			</p>
		);
	}
	return (
		<SpaceInvitationForm
			actionVariant="secondary"
			audience="guest"
			onBeforeCreate={input.enabled ? undefined : input.onEnable}
			spaceId={input.spaceId}
		/>
	);
}
