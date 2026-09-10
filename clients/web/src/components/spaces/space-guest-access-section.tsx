import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@openmeld/ui/fluid/accordion";
import { DialogContent } from "@openmeld/ui/fluid/dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
		<section className="border-border/60 border-t pt-4">
			<Accordion>
				<AccordionItem value="guests">
					<AccordionTrigger className="py-1 text-sm">
						External guests
					</AccordionTrigger>
					<AccordionContent>
						<div className="grid gap-3 pt-3">
							{status.isError ? (
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
							) : null}
							{!status.isError && status.data?.allowGuests ? (
								<>
									<SpaceInvitationForm audience="guest" spaceId={spaceId} />
									<p className="text-muted-foreground text-xs/relaxed">
										Turning this off blocks existing guests too. Turning it back
										on restores their access.
									</p>
									<div className="flex justify-end">
										<Button
											disabled={save.isPending}
											onClick={() => save.mutate(false)}
											size="sm"
											variant="ghost"
										>
											Turn off guest access
										</Button>
									</div>
								</>
							) : null}
							{status.isError || status.data?.allowGuests ? null : (
								<>
									<p className="text-muted-foreground text-xs/relaxed">
										Invite people outside your organization to work in this
										Space. Only invited people can join, and they must sign in.
									</p>
									<div className="flex justify-end">
										<Button
											disabled={status.isPending}
											onClick={() => setConfirm(true)}
											size="sm"
											variant="outline"
										>
											Allow guest invitations
										</Button>
									</div>
								</>
							)}
							{save.error ? (
								<p className="text-destructive text-xs" role="alert">
									{save.error.message}
								</p>
							) : null}
						</div>
					</AccordionContent>
				</AccordionItem>
			</Accordion>
			<Dialog onOpenChange={setConfirm} open={confirm}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Allow guests in this Space?</DialogTitle>
						<DialogDescription>
							Invited guests can read this Space’s history and files, send
							messages, and talk to its Agents. They won’t join your
							organization or see its other Spaces. Only share content and
							Agents you’re comfortable giving them access to. Previously
							admitted guests will also regain access.
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
