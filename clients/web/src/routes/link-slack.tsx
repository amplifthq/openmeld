import { Button } from "@openmeld/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@openmeld/ui/components/card";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod/v4";
import { AuthPageShell } from "#/components/auth/auth-page-shell";
import { useAuthSession } from "#/hooks/auth.hooks";
import { getSession } from "#/lib/auth-session";
import {
	consumeSlackIdentityLink,
	previewSlackIdentityLink,
	resolveCenterAgentErrorMessage,
} from "#/lib/organizations/center-agent";

const linkSlackSearchSchema = z.object({
	token: z.string().trim().min(1).optional(),
});

type LinkSlackSearch = {
	token?: string;
};

type SlackSetupPreview = Awaited<ReturnType<typeof previewSlackIdentityLink>>;
type SlackSetupResult = Awaited<ReturnType<typeof consumeSlackIdentityLink>>;

function resolveSlackSetupTitle(
	preview: SlackSetupPreview | undefined
): string {
	if (!preview) {
		return "Join OpenMeld";
	}
	if (preview.alreadyMember) {
		return "Connect your Slack account";
	}
	return `Join ${preview.organizationName} and connect Slack`;
}

function resolveSlackSetupSummary(
	preview: SlackSetupPreview,
	accountEmail: string | null
): string {
	const openMeldAccount = accountEmail ?? "this OpenMeld account";
	if (preview.alreadyMember) {
		return preview.continuesRequest
			? `Connect Slack account @${preview.slackDisplayName} to ${openMeldAccount} and continue your request.`
			: `Connect Slack account @${preview.slackDisplayName} to ${openMeldAccount}.`;
	}
	return preview.continuesRequest
		? `Join ${preview.organizationName} as ${openMeldAccount}, connect Slack account @${preview.slackDisplayName}, and continue your request.`
		: `Join ${preview.organizationName} as ${openMeldAccount} and connect Slack account @${preview.slackDisplayName}.`;
}

function resolveSlackSetupButtonLabel(input: {
	alreadyMember: boolean;
	continuesRequest: boolean;
	pending: boolean;
}): string {
	if (input.pending) {
		return "Setting you up...";
	}
	if (!input.continuesRequest) {
		return input.alreadyMember ? "Connect my account" : "Join and connect";
	}
	return input.alreadyMember
		? "Connect my account and continue"
		: "Join and continue";
}

function resolveSlackSetupCompletionMessage(result: SlackSetupResult): string {
	if (result.continued) {
		return "I'm continuing your original request in the same Slack thread now.";
	}
	if (result.continuationRetryable) {
		return "Your Slack account is connected, but I couldn't continue the request yet. Try continuing again.";
	}
	return "Your Slack account is connected. This older setup link cannot continue the request. Return to the original Slack thread and ask for a new setup button—you do not need to repeat your request.";
}

function SlackSetupCompleted(input: {
	continuesRequest: boolean;
	error: unknown;
	isPending: boolean;
	onRetry: () => void;
	result: SlackSetupResult;
}) {
	return (
		<div className="space-y-3">
			<p className="font-medium text-foreground text-sm">You're ready.</p>
			<p className="text-muted-foreground text-sm">
				{input.continuesRequest
					? resolveSlackSetupCompletionMessage(input.result)
					: "Your Slack account is connected. You can return to Slack now."}
			</p>
			{input.error ? (
				<p className="text-destructive text-sm">
					{resolveCenterAgentErrorMessage(input.error, "slack_link_consume")}
				</p>
			) : null}
			{input.result.continuationRetryable ? (
				<Button
					disabled={input.isPending}
					onClick={input.onRetry}
					type="button"
				>
					{input.isPending ? "Continuing..." : "Try continuing again"}
				</Button>
			) : null}
		</div>
	);
}

export const Route = createFileRoute("/link-slack")({
	validateSearch: (search): LinkSlackSearch => {
		const parsed = linkSlackSearchSchema.safeParse(search);
		return parsed.success ? parsed.data : {};
	},
	beforeLoad: async ({ location }) => {
		const session = await getSession({
			data: {
				currentUserSessionExpectation: "optional",
				routeFamily: location.pathname,
				sessionCacheMode: "bypass",
			},
		});
		if (!session) {
			throw redirect({
				to: "/login",
				search: {
					redirect: location.href,
				},
			});
		}
		return { session };
	},
	component: LinkSlackRoute,
});

function LinkSlackRoute() {
	const search = Route.useSearch();
	return (
		<AuthPageShell>
			<LinkSlackCard token={search.token ?? null} />
		</AuthPageShell>
	);
}

export function LinkSlackCard(input: { token: string | null }) {
	const [completedSetup, setCompletedSetup] = useState<SlackSetupResult | null>(
		null
	);
	const sessionQuery = useAuthSession();
	const previewQuery = useQuery({
		enabled: Boolean(input.token),
		queryFn: async () => {
			if (!input.token) {
				throw new Error("Slack link token is missing.");
			}
			return await previewSlackIdentityLink({ token: input.token });
		},
		queryKey: ["slack-identity-link", "preview", input.token],
		retry: false,
	});
	const consumeMutation = useMutation({
		mutationFn: async () => {
			if (!input.token) {
				throw new Error("Slack link token is missing.");
			}
			return await consumeSlackIdentityLink({ token: input.token });
		},
		onSuccess: setCompletedSetup,
	});

	const sessionEmail = sessionQuery.data?.user.email ?? null;
	const preview = previewQuery.data;
	const accountEmail = preview?.openMeldAccountEmail ?? sessionEmail;

	return (
		<Card className="w-full max-w-md">
			<CardHeader>
				<CardTitle>{resolveSlackSetupTitle(preview)}</CardTitle>
				<CardDescription>
					{preview?.continuesRequest
						? "Connect the Slack and OpenMeld accounts shown below. The Center Agent will then continue your original request in the same Slack thread."
						: "Check both accounts below, then connect them."}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{input.token ? null : (
					<p className="text-destructive text-sm">
						This setup link is incomplete. Return to the original Slack thread
						and ask the Center Agent for a new setup button. You do not need to
						repeat your request.
					</p>
				)}
				{input.token && previewQuery.isPending ? (
					<p className="text-muted-foreground text-sm">
						Checking this Slack link.
					</p>
				) : null}
				{previewQuery.isError ? (
					<p className="text-destructive text-sm">
						{resolveCenterAgentErrorMessage(
							previewQuery.error,
							"slack_link_preview"
						)}
					</p>
				) : null}
				{preview && completedSetup ? (
					<SlackSetupCompleted
						continuesRequest={preview.continuesRequest}
						error={consumeMutation.isError ? consumeMutation.error : undefined}
						isPending={consumeMutation.isPending}
						onRetry={() => consumeMutation.mutate()}
						result={completedSetup}
					/>
				) : null}
				{preview && !completedSetup ? (
					<div className="space-y-4">
						<div className="space-y-2 border border-border/70 bg-card/30 p-3">
							<p className="text-muted-foreground text-xs">Slack account</p>
							<p className="font-medium text-foreground text-sm">
								@{preview.slackDisplayName}
							</p>
							<p className="text-muted-foreground text-xs">
								Workspace {preview.slackWorkspaceLabel}
							</p>
						</div>
						<div className="space-y-2 border border-border/70 bg-card/30 p-3">
							<p className="text-muted-foreground text-xs">OpenMeld account</p>
							<p className="font-medium text-foreground text-sm">
								{accountEmail ?? "Current account"}
							</p>
							<p className="text-muted-foreground text-xs">
								{preview.organizationName}
							</p>
						</div>
						<p className="text-muted-foreground text-sm">
							{resolveSlackSetupSummary(preview, accountEmail)}
						</p>
						{consumeMutation.isError ? (
							<p className="text-destructive text-sm">
								{resolveCenterAgentErrorMessage(
									consumeMutation.error,
									"slack_link_consume"
								)}
							</p>
						) : null}
						<Button
							disabled={consumeMutation.isPending}
							onClick={() => consumeMutation.mutate()}
							type="button"
						>
							{resolveSlackSetupButtonLabel({
								alreadyMember: preview.alreadyMember,
								continuesRequest: preview.continuesRequest,
								pending: consumeMutation.isPending,
							})}
						</Button>
					</div>
				) : null}
			</CardContent>
		</Card>
	);
}
