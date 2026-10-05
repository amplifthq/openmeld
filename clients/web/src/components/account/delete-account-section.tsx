import {
	accountDeletionAcceptedSchema,
	accountDeletionPreviewSchema,
} from "@openmeld/schemas";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { Input } from "@openmeld/ui/components/input";
import { Label } from "@openmeld/ui/components/label";
import { SettingsSection } from "@openmeld/ui/components/settings-section";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAccountSession } from "#/hooks/account.hooks";
import { completeAccountAuthChange } from "#/query/auth-boundary";

async function readResponse(response: Response): Promise<unknown> {
	const body: unknown = await response.json();
	if (!response.ok) {
		throw new Error(
			body &&
				typeof body === "object" &&
				"message" in body &&
				typeof body.message === "string"
				? body.message
				: "Unable to load account deletion details. Try again."
		);
	}
	return body;
}

export function DeleteAccountSection() {
	const { data: session } = useAccountSession();
	const [open, setOpen] = useState(false);
	const [confirmation, setConfirmation] = useState("");
	const [password, setPassword] = useState("");
	const queryClient = useQueryClient();
	const preview = useQuery({
		queryKey: ["account", session?.user.id, "deletion-preview"],
		enabled: open,
		staleTime: 0,
		gcTime: 0,
		retry: false,
		queryFn: async () =>
			accountDeletionPreviewSchema.parse(
				await readResponse(
					await fetch("/v1/account/deletion", { cache: "no-store" })
				)
			),
	});
	const deletion = useMutation({
		mutationFn: async () => {
			if (!preview.data) {
				throw new Error("Review your account details first.");
			}
			accountDeletionAcceptedSchema.parse(
				await readResponse(
					await fetch("/v1/account/deletion", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							confirmation,
							confirmationToken: preview.data.confirmationToken,
							...(preview.data.requiresPassword ? { password } : {}),
						}),
					})
				)
			);
			try {
				await completeAccountAuthChange(queryClient, "signed-out");
			} finally {
				// Acceptance is irreversible even if this browser cannot clear its cache.
				window.location.replace("/account-deleted");
			}
		},
	});
	const details = preview.data;
	const changeOpen = (next: boolean) => {
		if (deletion.isPending) {
			return;
		}
		setOpen(next);
		if (!next) {
			setPassword("");
			setConfirmation("");
			deletion.reset();
		}
	};
	const blocked = Boolean(
		details &&
			(details.blockingOrganizations.length ||
				details.blockingSpaces.length ||
				details.requiresSignIn)
	);
	const canDelete = Boolean(
		details &&
			!blocked &&
			!preview.isError &&
			!deletion.isError &&
			!preview.isFetching &&
			confirmation === "DELETE" &&
			(!details.requiresPassword || password.length)
	);
	return (
		<SettingsSection
			description="Permanently close your account across all workspaces."
			id="account-deletion"
			title="Delete account"
		>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<p className="max-w-lg text-muted-foreground text-sm">
					Review what will be deleted and what stays with your teams before you
					continue.
				</p>
				<Button
					className="text-destructive"
					onClick={() => setOpen(true)}
					size="sm"
					variant="outline"
				>
					Delete account…
				</Button>
			</div>
			<Dialog onOpenChange={changeOpen} open={open}>
				<DialogContent
					className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden text-sm sm:max-w-lg"
					showCloseButton={!deletion.isPending}
				>
					<DialogHeader className="pr-6">
						<DialogTitle>Delete your account?</DialogTitle>
						<DialogDescription>
							This permanently closes{" "}
							{session?.user.email ?? "your OpenMeld account"} across all
							workspaces. You cannot undo this.
						</DialogDescription>
					</DialogHeader>
					<ScrollArea
						className="min-h-0 flex-1"
						contentClassName="space-y-5 pr-2"
					>
						{preview.isPending && (
							<output className="text-muted-foreground">
								Checking your workspaces and account…
							</output>
						)}
						{preview.isError && (
							<div className="space-y-2" role="alert">
								<p className="text-destructive">{preview.error.message}</p>
								<Button
									onClick={() => preview.refetch()}
									size="sm"
									variant="outline"
								>
									Try again
								</Button>
							</div>
						)}
						{details && (
							<>
								<section
									aria-labelledby="account-delete-list"
									className="space-y-2"
								>
									<h3 className="font-medium" id="account-delete-list">
										Deleted
									</h3>
									<ul className="list-disc space-y-1 pl-4 text-muted-foreground">
										<li>
											Your sign-in details, profile photo, and personal
											profiles.
										</li>
										<li>
											Your private files, personal Computer, private Agent
											chats, synced sessions, and saved personal Agent memory.
										</li>
										{details.deleteOrganizations.length > 0 && (
											<li>
												Workspaces where you are the only member:{" "}
												<span className="text-foreground">
													{details.deleteOrganizations
														.map((org) => org.name)
														.join(", ")}
												</span>
												. Their Spaces, files, and Skills will be deleted,
												including content shared by link or with guests.
											</li>
										)}
									</ul>
								</section>
								<section
									aria-labelledby="account-retain-list"
									className="space-y-2"
								>
									<h3 className="font-medium" id="account-retain-list">
										Kept for your teams
									</h3>
									<p className="text-muted-foreground">
										Messages, shared files, Skills, and work records in
										workspaces with other members stay available to them. Your
										earlier messages may still contain your name or information
										you shared.
									</p>
									{details.retainOrganizations.length > 0 && (
										<p className="text-muted-foreground">
											{details.retainOrganizations
												.map((org) => org.name)
												.join(", ")}
										</p>
									)}
								</section>
								{(details.blockingOrganizations.length > 0 ||
									details.blockingSpaces.length > 0) && (
									<section
										aria-labelledby="account-handoff-list"
										className="space-y-2 rounded-md border border-border p-3"
									>
										<h3 className="font-medium" id="account-handoff-list">
											Transfer ownership first
										</h3>
										<p className="text-muted-foreground">
											Choose another owner so your teammates can keep managing
											this work.
										</p>
										<ul className="list-disc space-y-1 pl-4">
											{details.blockingOrganizations.map((org) => (
												<li key={org.id}>
													<a
														className="underline underline-offset-2"
														href={`/o/${encodeURIComponent(org.slug)}/settings/members`}
													>
														{org.name} — workspace owner
													</a>
												</li>
											))}
											{details.blockingSpaces.map((space) => (
												<li key={space.spaceId}>{space.name} — Space owner</li>
											))}
										</ul>
										<Button
											disabled={preview.isFetching}
											onClick={() => preview.refetch()}
											size="sm"
											variant="outline"
										>
											Check again
										</Button>
									</section>
								)}
								{details.requiresSignIn && (
									<div className="space-y-2">
										<p>
											Sign in again to confirm that this is your account, then
											return here.
										</p>
										<Button
											onClick={() => window.location.assign("/logout")}
											size="sm"
											variant="outline"
										>
											Sign in again
										</Button>
									</div>
								)}
								{!blocked && (
									<div className="space-y-4 border-border border-t pt-4">
										{details.requiresPassword && (
											<div className="space-y-2">
												<Label htmlFor="delete-account-password">
													Current password
												</Label>
												<Input
													autoComplete="current-password"
													disabled={deletion.isPending}
													id="delete-account-password"
													onChange={(event) => setPassword(event.target.value)}
													type="password"
													value={password}
												/>
											</div>
										)}
										<div className="space-y-2">
											<Label htmlFor="delete-account-confirmation">
												Type DELETE to confirm
											</Label>
											<Input
												autoComplete="off"
												disabled={deletion.isPending}
												id="delete-account-confirmation"
												onChange={(event) =>
													setConfirmation(event.target.value)
												}
												value={confirmation}
											/>
										</div>
										<p className="text-muted-foreground">
											You will be signed out immediately. Private data cleanup
											continues in the background.
										</p>
									</div>
								)}
							</>
						)}
						{deletion.isError && (
							<div className="space-y-2">
								<p className="text-destructive" role="alert">
									{deletion.error.message}
								</p>
								<Button
									disabled={preview.isFetching}
									onClick={() => {
										deletion.reset();
										setConfirmation("");
										preview.refetch();
									}}
									size="sm"
									variant="outline"
								>
									Review again
								</Button>
							</div>
						)}
					</ScrollArea>
					<DialogFooter className="border-border border-t pt-3">
						<Button
							disabled={deletion.isPending}
							onClick={() => changeOpen(false)}
							variant="outline"
						>
							Cancel
						</Button>
						<Button
							disabled={!canDelete || deletion.isPending}
							onClick={() => deletion.mutate()}
							variant="destructive"
						>
							{deletion.isPending ? "Deleting account…" : "Delete account"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</SettingsSection>
	);
}
