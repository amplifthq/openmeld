import { Button } from "@openmeld/ui/components/button";
import { Input } from "@openmeld/ui/components/input";
import { Label } from "@openmeld/ui/components/label";
import { SkeletonRows } from "@openmeld/ui/components/skeleton-content";
import { useId, useState } from "react";
import { usePluginActionRequest } from "#/query/organizations/plugin-action-requests";

const STATE_COPY = {
	approved:
		"Approved. The Agent can continue this request. Approval does not mean the operation has run.",
	rejected:
		"Declined. No new operation was authorized. Earlier operations remain unchanged.",
	expired:
		"This request expired. Ask the Agent for a new request if you still want to proceed.",
	revoked:
		"This account or its permissions changed. Review the connection in Plugins before requesting another action.",
} as const;
const EFFECT_COPY = {
	destructive: "Deletes or irreversibly changes data",
	write: "Creates or changes data",
	unspecified: "May change data",
} as const;

export function PluginActionRequest({ requestId }: { requestId: string }) {
	const { query, mutation } = usePluginActionRequest(requestId);
	const [code, setCode] = useState("");
	const [error, setError] = useState<string | null>(null);
	const codeId = useId();
	const descriptionId = useId();
	const request = query.data;
	const disabled = mutation.isPending || query.isRefetchError;
	async function respond(operation: "send_code" | "approve" | "reject") {
		setError(null);
		try {
			await mutation.mutateAsync(
				operation === "send_code"
					? { operation, requestId }
					: { operation, requestId, code }
			);
			setCode("");
		} catch (failure) {
			setError(
				failure instanceof Error
					? failure.message
					: "Your response could not be confirmed. Refresh this request before trying again."
			);
		} finally {
			// Do not retain a submitted email code in the mutation cache.
			mutation.reset();
		}
	}
	if (query.isPending) {
		return <SkeletonRows label="Loading Plugin request" rows={3} />;
	}
	if (!request) {
		return (
			<div className="mt-3 space-y-2 rounded-md border border-border/70 p-4">
				<p className="text-destructive text-sm" role="alert">
					This request is unavailable. It may belong to another account or
					organization.
				</p>
				<Button onClick={() => query.refetch()} size="sm" variant="outline">
					Refresh request
				</Button>
			</div>
		);
	}
	return (
		<div className="mt-3 space-y-4 rounded-md border border-border/70 p-4 sm:p-5">
			<div className="space-y-1">
				<h3 className="font-medium text-sm">Confirm a Plugin action</h3>
				<p className="text-muted-foreground text-sm">
					Review this new operation. Earlier unknown results stay unresolved.
				</p>
			</div>
			<dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
				<div>
					<dt className="text-muted-foreground">Plugin</dt>
					<dd className="break-words">{request.service}</dd>
				</div>
				<div>
					<dt className="text-muted-foreground">Account</dt>
					<dd className="break-words">
						{request.accountName} ·{" "}
						{request.accountScope === "shared" ? "Shared" : "Personal"}
					</dd>
				</div>
				<div>
					<dt className="text-muted-foreground">Action</dt>
					<dd className="break-all">{request.actionId}</dd>
				</div>
				<div>
					<dt className="text-muted-foreground">Effect</dt>
					<dd>{EFFECT_COPY[request.effect]}</dd>
				</div>
				{request.targets.map((target) => (
					<div key={target.label}>
						<dt className="text-muted-foreground">{target.label}</dt>
						<dd className="break-all">{target.value}</dd>
					</div>
				))}
			</dl>
			<p className="text-muted-foreground text-xs">
				This approval applies to the exact account and submitted input. Private
				content and credentials are not shown here. Only approve if you
				recognize the action you asked for.
			</p>
			{request.state === "pending" ? (
				<form
					className="space-y-3 border-border/70 border-t pt-4"
					onSubmit={(event) => {
						event.preventDefault();
						respond("approve");
					}}
				>
					<p className="text-muted-foreground text-sm" id={descriptionId}>
						To confirm it’s you, enter the code sent to your verified account
						email. This request expires at{" "}
						{new Date(request.expiresAtMs).toLocaleTimeString([], {
							hour: "numeric",
							minute: "2-digit",
						})}
						.
					</p>
					<Button
						disabled={disabled}
						onClick={() => respond("send_code")}
						size="sm"
						type="button"
						variant="outline"
					>
						{request.verificationRequested ? "Resend code" : "Email me a code"}
					</Button>
					{request.verificationRequested ? (
						<>
							<div className="max-w-md space-y-1.5">
								<Label htmlFor={codeId}>Confirmation code</Label>
								<Input
									aria-describedby={descriptionId}
									autoComplete="one-time-code"
									disabled={disabled}
									id={codeId}
									maxLength={128}
									onChange={(event) => setCode(event.target.value)}
									spellCheck={false}
									value={code}
								/>
							</div>
							<div className="flex flex-wrap gap-2">
								<Button
									disabled={disabled || !code.trim()}
									size="sm"
									type="submit"
								>
									Approve action
								</Button>
								<Button
									disabled={disabled || !code.trim()}
									onClick={() => respond("reject")}
									size="sm"
									type="button"
									variant="outline"
								>
									Decline request
								</Button>
							</div>
						</>
					) : null}
				</form>
			) : (
				<output className="block border-border/70 border-t pt-3 text-sm">
					{STATE_COPY[request.state]}
				</output>
			)}
			{error ? (
				<p className="text-destructive text-sm" role="alert">
					{error}
				</p>
			) : null}
			{query.isRefetchError ? (
				<div className="space-y-2">
					<p className="text-destructive text-sm" role="alert">
						Couldn’t refresh this request. Confirm its current status before
						responding.
					</p>
					<Button onClick={() => query.refetch()} size="sm" variant="outline">
						Refresh request
					</Button>
				</div>
			) : null}
		</div>
	);
}
