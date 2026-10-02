import { TooltipHint } from "@openmeld/ui/components/tooltip";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { requestInboxSourceFocus } from "#/lib/inbox/source-focus-request";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import { spaceInboxUnreadTargetsQueryOptions } from "#/query/organizations/inbox";

export function SpaceUnreadButton(input: {
	spaceId: string;
	url: string;
	count: number;
}) {
	const organization = useOptionalAppOrganization();
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const [pending, setPending] = useState(false);
	return (
		<TooltipHint content="Jump to first unread">
			<button
				aria-label={`${input.count} unread ${input.count === 1 ? "update" : "updates"}. Jump to first unread`}
				className="status-dot pointer-events-auto relative z-10 cursor-pointer bg-unread outline-none focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
				data-conversation-unread-indicator="true"
				disabled={pending}
				onClick={async (event) => {
					event.stopPropagation();
					if (!organization || pending) {
						return;
					}
					setPending(true);
					try {
						const data = await queryClient.fetchQuery({
							...spaceInboxUnreadTargetsQueryOptions({
								organizationId: organization.currentOrganization.id,
								spaceId: input.spaceId,
							}),
							staleTime: 0,
						});
						const target = data.targets[0];
						const url = new URL(input.url, "https://openmeld.invalid");
						for (const key of [
							"view",
							"focusInteractionId",
							"focusSignalId",
							"focusThreadRootSignalId",
						]) {
							url.searchParams.delete(key);
						}
						if (target) {
							url.searchParams.set("focusSignalId", target.signalId);
							if (target.threadRootSignalId) {
								url.searchParams.set(
									"focusThreadRootSignalId",
									target.threadRootSignalId
								);
							}
						}
						await navigate({
							to: url.pathname,
							search: Object.fromEntries(url.searchParams),
							state: requestInboxSourceFocus,
							resetScroll: false,
						});
					} catch {
						toast.error("Couldn’t open unread updates. Try again.");
					} finally {
						setPending(false);
					}
				}}
				type="button"
			/>
		</TooltipHint>
	);
}
