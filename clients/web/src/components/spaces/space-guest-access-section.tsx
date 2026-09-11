import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { Switch } from "@openmeld/ui/components/switch";
import { DialogContent } from "@openmeld/ui/fluid/dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { createUnscopedWebSpaceApi } from "#/lib/spaces/api";
import { spaceQueryKeys, spaceStatusQueryOptions } from "#/query/spaces/status";
import { SpaceInvitationForm } from "./space-invitations-section";

export function SpaceGuestAccessSection({
	spaceId,
	openMeldProfileId,
	surface = "settings",
}: {
	surface?: "settings" | "share";
	spaceId: string;
	openMeldProfileId?: string;
}) {
	const [confirm, setConfirm] = useState(surface === "share");
	const switchId = useId();
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
		onSuccess: async () => {
			setConfirm(false);
			await client.invalidateQueries({ queryKey: spaceQueryKeys.all });
		},
	});
	return (
		<section
			className={
				surface === "share" ? "grid gap-2" : "border-border/60 border-t pt-4"
			}
		>
			{surface === "share" ? (
				<GuestInvitationEntry
					enabled={status.data?.allowGuests === true}
					failed={status.isError}
					onEnable={() => setConfirm(true)}
					onRetry={() => status.refetch()}
					pending={status.isPending}
					spaceId={spaceId}
				/>
			) : (
				<div className="grid gap-2">
					<div className="flex items-center justify-between gap-3">
						<label
							className="font-medium text-sm"
							htmlFor={switchId}
							id={`${switchId}-label`}
						>
							Allow external guests
						</label>
						<Switch
							aria-labelledby={`${switchId}-label`}
							checked={status.data?.allowGuests === true}
							disabled={!status.isSuccess || save.isPending}
							id={switchId}
							onCheckedChange={(checked) => {
								if (checked) {
									setConfirm(true);
								} else {
									save.mutate(false);
								}
							}}
						/>
					</div>
					<p className="text-muted-foreground text-xs/relaxed">
						Invite guests from Share. They sign in to access only this Space.
					</p>
					{status.data?.allowGuests && (
						<p className="text-muted-foreground text-xs/relaxed">
							Turning this off blocks all guests. Turning it back on restores
							their access.
						</p>
					)}
					{status.isPending && (
						<p className="text-muted-foreground text-xs">
							Checking guest access…
						</p>
					)}
					{status.isError && (
						<p className="text-destructive text-xs" role="alert">
							Couldn't check guest access.{" "}
							<Button
								onClick={() => status.refetch()}
								size="sm"
								variant="ghost"
							>
								Try again
							</Button>
						</p>
					)}
					{save.error && (
						<p className="text-destructive text-xs" role="alert">
							{save.error.message}
						</p>
					)}
				</div>
			)}
			<Dialog
				onOpenChange={setConfirm}
				open={confirm && status.isSuccess && !status.data.allowGuests}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Allow guests in this Space?</DialogTitle>
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
						<Button onClick={() => setConfirm(false)} variant="ghost">
							Cancel
						</Button>
						<Button disabled={save.isPending} onClick={() => save.mutate(true)}>
							Allow guest invitations
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
	onEnable: () => void;
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
				<Button onClick={input.onRetry} size="sm" variant="ghost">
					Try again
				</Button>
			</p>
		);
	}
	if (input.enabled) {
		return <SpaceInvitationForm audience="guest" spaceId={input.spaceId} />;
	}
	return (
		<div className="flex items-center justify-between gap-2">
			<p className="text-muted-foreground text-xs">
				Guests join only this Space.
			</p>
			<Button onClick={input.onEnable} size="sm" variant="outline">
				Enable guest invitations
			</Button>
		</div>
	);
}
