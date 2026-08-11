"use client";

import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@openmeld/ui/components/dialog";
import { BrainIcon } from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { getAuthErrorMessage } from "#/lib/auth-errors";
import { wipeCurrentMemberCenterAgentMemory } from "#/lib/organizations/center-agent-memory";
import { useAppOrganization } from "#/lib/organizations/organization-context";

export function CenterAgentMemberMemorySection() {
	const { currentOrganization } = useAppOrganization();
	const isPersonalWorkspace = currentOrganization.isPersonal === true;
	const [open, setOpen] = useState(false);
	const [statusMessage, setStatusMessage] = useState<string | null>(null);
	const wipeMemory = useMutation({
		mutationFn: async () =>
			await wipeCurrentMemberCenterAgentMemory({
				organizationId: currentOrganization.id,
			}),
	});

	async function handleConfirm() {
		setStatusMessage(null);
		try {
			await wipeMemory.mutateAsync();
			setStatusMessage("Your Center Agent memory was erased.");
			setOpen(false);
		} catch (error) {
			setStatusMessage(
				getAuthErrorMessage(error, "Failed to erase Center Agent memory.")
			);
		}
	}

	return (
		<section className="overflow-hidden rounded-md border border-border/70 bg-card/20">
			<div className="border-border/70 border-b px-5 py-4">
				<h2 className="flex items-center gap-2 font-medium text-foreground text-sm">
					<BrainIcon aria-hidden="true" className="size-4" />
					Center Agent Memory
				</h2>
			</div>
			<div className="space-y-3 px-5 py-4">
				<p className="text-muted-foreground text-sm">
					Erase what the Center Agent remembers about you in this{" "}
					{isPersonalWorkspace ? "personal workspace" : "organization"}. This
					does not delete messages, Spaces, or{" "}
					{isPersonalWorkspace ? "workspace" : "shared organization"} memory.
					This action cannot be undone.
				</p>
				{statusMessage ? (
					<p
						className="text-muted-foreground text-xs"
						role={wipeMemory.isError ? "alert" : "status"}
					>
						{statusMessage}
					</p>
				) : null}
				<Dialog onOpenChange={setOpen} open={open}>
					<DialogTrigger render={<Button size="sm" variant="destructive" />}>
						Erase memory
					</DialogTrigger>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>Erase your Center Agent memory?</DialogTitle>
							<DialogDescription>
								This deletes the personal memory the Center Agent has built for
								you in this{" "}
								{isPersonalWorkspace ? "personal workspace" : "organization"}.
								Your messages, Spaces, and{" "}
								{isPersonalWorkspace ? "workspace" : "shared organization"}{" "}
								memory stay in place.
							</DialogDescription>
						</DialogHeader>
						<DialogFooter>
							<Button
								disabled={wipeMemory.isPending}
								onClick={() => setOpen(false)}
								type="button"
								variant="outline"
							>
								Cancel
							</Button>
							<Button
								disabled={wipeMemory.isPending}
								onClick={() => {
									handleConfirm().catch(() => undefined);
								}}
								type="button"
								variant="destructive"
							>
								{wipeMemory.isPending ? "Erasing..." : "Erase memory"}
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			</div>
		</section>
	);
}
