"use client";

import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { WrenchIcon } from "@phosphor-icons/react";
import { useState } from "react";
import type { AgentProfileBulkReconnectCandidate } from "./agents-page-agent-profile-helpers";

export function AgentProfileBulkReconnectNotice(input: {
	candidates: readonly AgentProfileBulkReconnectCandidate[];
	isPending: boolean;
	onReconnect: (
		candidates: readonly AgentProfileBulkReconnectCandidate[]
	) => Promise<void>;
}) {
	const [dialogOpen, setDialogOpen] = useState(false);
	const count = input.candidates.length;
	return (
		<>
			<section
				aria-label="Reconnect Agents"
				className="mb-4 flex flex-col gap-3 border-border/70 border-b pb-4 sm:flex-row sm:items-center sm:justify-between"
			>
				<div className="min-w-0 space-y-1">
					<p className="font-medium text-foreground text-sm">
						Reconnect {count} Agents
					</p>
					<p className="max-w-3xl text-muted-foreground text-sm leading-5">
						Their saved local agents are connected to an older setup for this
						computer. Reconnect them together while keeping each profile's
						settings.
					</p>
				</div>
				<Button
					disabled={input.isPending}
					onClick={() => setDialogOpen(true)}
					size="sm"
					type="button"
					variant="outline"
				>
					<WrenchIcon aria-hidden="true" data-icon="inline-start" />
					{input.isPending ? "Reconnecting..." : "Reconnect all"}
				</Button>
			</section>
			<Dialog onOpenChange={setDialogOpen} open={dialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Reconnect {count} Agents?</DialogTitle>
						<DialogDescription>
							OpenMeld will move these local agent connections to this computer.
							Their local agent, model, permission settings, and existing
							conversations stay the same. Running work is not interrupted.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<DialogClose
							render={
								<Button
									disabled={input.isPending}
									type="button"
									variant="outline"
								/>
							}
						>
							Cancel
						</DialogClose>
						<Button
							disabled={input.isPending}
							onClick={() => {
								input
									.onReconnect(input.candidates)
									.then(() => setDialogOpen(false))
									.catch((error: unknown) => {
										console.error(
											"Failed to reconnect Agent Profiles to this computer.",
											error
										);
									});
							}}
							type="button"
						>
							{input.isPending ? "Reconnecting..." : "Reconnect Agents"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
