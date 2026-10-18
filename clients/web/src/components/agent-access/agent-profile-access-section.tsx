import { Button } from "@openmeld/ui/components/button";
import { SkeletonRows } from "@openmeld/ui/components/skeleton-content";
import { isMemberAgentsEnabled } from "#/lib/member-agents/member-agents-feature";
import {
	useAgentProfileAccessGrants,
	useRevokeAgentProfileAccessGrant,
} from "#/query/agent-access";

/**
 * Owner-only: who may use this Agent without asking, and Revoke. Revoking
 * stops new tasks; tasks already running finish.
 */
export function AgentProfileAccessSection(input: {
	enabled: boolean;
	profileId: string;
}) {
	if (!(input.enabled && isMemberAgentsEnabled())) {
		return null;
	}
	return <AgentProfileAccessList profileId={input.profileId} />;
}

function AgentProfileAccessList(input: { profileId: string }) {
	const grants = useAgentProfileAccessGrants(input.profileId);
	const revoke = useRevokeAgentProfileAccessGrant(input.profileId);
	return (
		<section
			aria-labelledby="agent-access-heading"
			className="grid max-w-3xl gap-3"
		>
			<div className="grid gap-1">
				<h2 className="font-medium text-sm" id="agent-access-heading">
					Who can use this Agent
				</h2>
				<p className="text-muted-foreground text-sm">
					Colleagues you allowed can start work without asking. Revoking stops
					new work; anything already running finishes.
				</p>
			</div>
			{grants.isPending ? (
				<SkeletonRows label="Loading access" rows={2} />
			) : null}
			{grants.isError ? (
				<p className="text-destructive text-sm" role="alert">
					Couldn't load who can use this Agent.
				</p>
			) : null}
			{grants.data?.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					No one else can use this Agent without asking you first.
				</p>
			) : null}
			{grants.data && grants.data.length > 0 ? (
				<ul className="divide-y divide-border rounded-lg border border-border">
					{grants.data.map((grant) => (
						<li
							className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
							key={grant.id}
						>
							<span className="min-w-0">
								<span className="block truncate">{grant.granteeName}</span>
								<span className="block text-muted-foreground text-xs">
									{grant.scope === "always"
										? "Always allowed"
										: "Allowed for one chat"}
								</span>
							</span>
							<Button
								disabled={revoke.isPending}
								onClick={() => revoke.mutate(grant.id)}
								size="sm"
								variant="outline"
							>
								Revoke
							</Button>
						</li>
					))}
				</ul>
			) : null}
			{revoke.error ? (
				<p className="text-destructive text-sm" role="alert">
					{revoke.error.message}
				</p>
			) : null}
		</section>
	);
}
