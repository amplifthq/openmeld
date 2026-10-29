import type { PluginActionRequestView } from "@openmeld/schemas/types";
import { ApprovalCardBody } from "@openmeld/ui/components/approval-card";

const EFFECT_COPY = {
	destructive: "Deletes or irreversibly changes data",
	write: "Creates or changes data",
	unspecified: "May change data",
} as const;

export function PluginActionRequestDetails({
	request,
	issueProvider,
}: {
	request: PluginActionRequestView;
	issueProvider: string | null;
}) {
	const targets =
		request.issuePreview?.targets.map((target) => ({
			label: target.label,
			value: target.name ?? "Name unavailable",
			detail: target.id !== target.name ? target.id : null,
		})) ?? request.targets.map((target) => ({ ...target, detail: null }));
	return (
		<ApprovalCardBody
			className={issueProvider ? "max-h-[min(48dvh,28rem)]" : undefined}
		>
			<dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
				{!issueProvider && (
					<div>
						<dt className="text-muted-foreground">Plugin</dt>
						<dd className="break-words">{request.service}</dd>
					</div>
				)}
				<div>
					<dt className="text-muted-foreground">Account</dt>
					<dd className="break-words">
						{request.accountName} ·{" "}
						{request.accountScope === "shared" ? "Shared" : "Personal"}
					</dd>
				</div>
				{!issueProvider && (
					<div>
						<dt className="text-muted-foreground">Action</dt>
						<dd className="break-all">{request.actionId}</dd>
					</div>
				)}
				{!issueProvider && (
					<div>
						<dt className="text-muted-foreground">Effect</dt>
						<dd>{EFFECT_COPY[request.effect]}</dd>
					</div>
				)}
				{targets.map((target) => (
					<div className="min-w-0" key={target.label}>
						<dt className="text-muted-foreground">{target.label}</dt>
						<dd className="[overflow-wrap:anywhere]">
							{target.value}
							{target.detail ? (
								<span className="mt-1 block break-all text-muted-foreground text-xs">
									{target.detail}
								</span>
							) : null}
						</dd>
					</div>
				))}
			</dl>
			{issueProvider ? <IssueContent preview={request.issuePreview} /> : null}
			<p className="text-muted-foreground text-xs">
				This approval applies to the exact account and submitted input.{" "}
				{previewScopeCopy(request)}
			</p>
			{request.state === "pending" ? (
				<p className="text-muted-foreground text-sm">
					Only your signed-in account can approve this request. It expires at{" "}
					{new Date(request.expiresAtMs).toLocaleTimeString([], {
						hour: "numeric",
						minute: "2-digit",
					})}
					.
				</p>
			) : null}
		</ApprovalCardBody>
	);
}

function IssueContent({
	preview,
}: {
	preview: PluginActionRequestView["issuePreview"];
}) {
	if (!preview) {
		return (
			<p className="text-muted-foreground text-sm">
				The original issue content is unavailable for this request. Ask the
				Agent for a new request if you need to review it.
			</p>
		);
	}
	return (
		<dl className="grid min-w-0 gap-3 text-sm">
			<div className="min-w-0">
				<dt className="text-muted-foreground">Issue title</dt>
				<dd className="whitespace-pre-wrap [overflow-wrap:anywhere]">
					{preview.title ?? "Title unavailable"}
				</dd>
			</div>
			<div className="min-w-0">
				<dt className="text-muted-foreground">Description</dt>
				<dd className="whitespace-pre-wrap [overflow-wrap:anywhere]">
					{preview.description || "No description provided."}
				</dd>
			</div>
		</dl>
	);
}

function previewScopeCopy(request: PluginActionRequestView) {
	if (request.issuePreview) {
		return request.issuePreview.additionalFieldCount > 0
			? "Additional issue settings are not shown."
			: "The title and description above are the original submitted content.";
	}
	return request.inputFieldCount > request.targets.length
		? "Some input is not shown. This summary does not verify omitted content."
		: "Review the details before approving.";
}
