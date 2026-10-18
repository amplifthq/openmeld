import type {
	SensitiveOperationAuditEvent,
	SensitiveOperationOutcome,
	SensitiveOperationSourceKind,
} from "@openmeld/schemas";
import { SkeletonRows } from "@openmeld/ui/components/skeleton-content";
import { isMemberAgentsEnabled } from "#/lib/member-agents/member-agents-feature";
import { useMemberAgentSensitiveOperationAudit } from "#/query/sensitive-operations";
import { credentialConfirmationOperationLabel } from "./credential-confirmation-card";

const SOURCE_LABELS: Record<SensitiveOperationSourceKind, string> = {
	cli_credential: "Your computer's sign-in",
	task_credential: "An Agent task",
	web_session: "Web or app",
};

const OUTCOME_LABELS: Record<SensitiveOperationOutcome, string> = {
	confirmation_required: "Waiting for your confirmation",
	declined: "Declined",
	failed: "Failed",
	rejected: "Blocked",
	succeeded: "Done",
};

const timeFormatter = new Intl.DateTimeFormat(undefined, {
	dateStyle: "medium",
	timeStyle: "short",
});

/** Owner-only: sensitive changes to this Agent and where they came from. */
export function SensitiveOperationAuditSection(input: {
	memberAgentId: string;
	profileNames: ReadonlyMap<string, string>;
}) {
	if (!isMemberAgentsEnabled()) {
		return null;
	}
	return <SensitiveOperationAuditList {...input} />;
}

function SensitiveOperationAuditList(input: {
	memberAgentId: string;
	profileNames: ReadonlyMap<string, string>;
}) {
	const audit = useMemberAgentSensitiveOperationAudit(input.memberAgentId);
	return (
		<section
			aria-labelledby="sensitive-operation-audit-heading"
			className="space-y-2"
		>
			<div className="grid gap-1">
				<h2
					className="font-medium text-sm"
					id="sensitive-operation-audit-heading"
				>
					Sensitive changes
				</h2>
				<p className="text-muted-foreground text-sm">
					Settings, folders, approvals and access changes, and where each one
					came from.
				</p>
			</div>
			{audit.isPending ? (
				<SkeletonRows label="Loading changes" rows={2} />
			) : null}
			{audit.isError ? (
				<p className="text-destructive text-sm" role="alert">
					Couldn't load sensitive changes.
				</p>
			) : null}
			{audit.data?.length === 0 ? (
				<p className="text-muted-foreground text-sm">No changes yet.</p>
			) : null}
			{audit.data && audit.data.length > 0 ? (
				<ul className="divide-y rounded-lg border">
					{audit.data.map((event) => (
						<AuditRow
							event={event}
							key={event.id}
							profileName={
								event.agentProfileId
									? (input.profileNames.get(event.agentProfileId) ?? null)
									: null
							}
						/>
					))}
				</ul>
			) : null}
		</section>
	);
}

function AuditRow(input: {
	event: SensitiveOperationAuditEvent;
	profileName: string | null;
}) {
	const { event } = input;
	return (
		<li className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
			<span className="min-w-0">
				<span className="block truncate">
					{credentialConfirmationOperationLabel(event.operation)}
				</span>
				<span className="block truncate text-muted-foreground text-xs">
					{[input.profileName, SOURCE_LABELS[event.sourceKind]]
						.filter(Boolean)
						.join(" · ")}
				</span>
			</span>
			<span className="shrink-0 text-right text-xs">
				<span className="block">{OUTCOME_LABELS[event.outcome]}</span>
				<time
					className="block text-muted-foreground"
					dateTime={new Date(event.createdAtMs).toISOString()}
				>
					{timeFormatter.format(event.createdAtMs)}
				</time>
			</span>
		</li>
	);
}
