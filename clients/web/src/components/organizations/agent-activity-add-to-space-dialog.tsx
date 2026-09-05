import type { AgentActivityInventorySession } from "@openmeld/schemas/types";
import { Badge } from "@openmeld/ui/components/badge";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { joinProfileToSpace } from "#/lib/profiles/join-profile-to-space";
import { useSelectedHumanProfile } from "#/lib/profiles/use-selected-human-profile";
import { organizationSpacesQueryOptions } from "#/query/organizations/organization-directory";

export function AgentActivityAddToSpaceDialog(input: {
	onOpenChange: (open: boolean) => void;
	open: boolean;
	organizationId: string;
	session: AgentActivityInventorySession;
}) {
	const queryClient = useQueryClient();
	const { selectedHumanProfile } = useSelectedHumanProfile({
		selectDefaultWhenMissing: true,
	});
	const spacesQuery = useQuery(
		organizationSpacesQueryOptions({
			enabled: input.open,
			organizationId: input.organizationId,
		})
	);
	const mutation = useMutation({
		mutationFn: async (space: { name: string; spaceId: string }) => {
			const agentProfileId = input.session.boundAgentProfileId;
			if (!(agentProfileId && selectedHumanProfile)) {
				throw new Error(
					"A connected Agent and an active profile are required."
				);
			}
			await joinProfileToSpace({
				actingHumanProfile: selectedHumanProfile,
				memberProfileIds: [agentProfileId],
				organizationId: input.organizationId,
				queryClient,
				spaceId: space.spaceId,
				spaceName: space.name,
			});
			return space;
		},
		onError: (error) => {
			toast.error(
				error instanceof Error && error.message
					? error.message
					: "OpenMeld could not add this Agent Profile to the Space."
			);
		},
		onSuccess: (space) => {
			toast.success(`Agent Profile added to ${space.name}.`);
			input.onOpenChange(false);
		},
	});
	const spaces = spacesQuery.data?.spaces ?? [];
	return (
		<Dialog
			onOpenChange={(open) => {
				if (!mutation.isPending) {
					input.onOpenChange(open);
				}
			}}
			open={input.open}
		>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Add Agent Profile to a Space</DialogTitle>
					<DialogDescription>
						Choose where {input.session.nativeSessionTitle ?? "this Session"}
						should collaborate. Space membership is still checked by the
						authoritative Space service.
					</DialogDescription>
				</DialogHeader>
				<div className="grid max-h-96 gap-2 overflow-y-auto pr-1">
					{spacesQuery.isPending ? (
						<p className="py-8 text-center text-muted-foreground text-sm">
							Loading Spaces…
						</p>
					) : null}
					{spacesQuery.isError ? (
						<div className="grid justify-items-center gap-3 py-8 text-center">
							<p className="text-muted-foreground text-sm">
								OpenMeld could not load Spaces.
							</p>
							<Button
								onClick={() => {
									spacesQuery.refetch().catch((error: unknown) => {
										console.error("Failed to refresh Spaces.", error);
									});
								}}
								size="sm"
								type="button"
								variant="outline"
							>
								Retry
							</Button>
						</div>
					) : null}
					{!(spacesQuery.isPending || spacesQuery.isError) &&
					spaces.length === 0 ? (
						<p className="py-8 text-center text-muted-foreground text-sm">
							No Spaces are available in this Organization.
						</p>
					) : null}
					{spaces.map((space) => (
						<div
							className="flex items-center justify-between gap-4 rounded-md border px-3 py-3"
							key={space.spaceId}
						>
							<div className="min-w-0">
								<p className="truncate font-medium text-sm">{space.name}</p>
								<Badge
									className="mt-1 rounded-md font-normal"
									variant="outline"
								>
									{space.visibility === "public" ? "Public" : "Private"}
								</Badge>
							</div>
							<Button
								disabled={mutation.isPending || !selectedHumanProfile}
								onClick={() => mutation.mutate(space)}
								size="sm"
								type="button"
								variant="outline"
							>
								{mutation.isPending &&
								mutation.variables?.spaceId === space.spaceId
									? "Adding…"
									: "Add"}
							</Button>
						</div>
					))}
				</div>
			</DialogContent>
		</Dialog>
	);
}
