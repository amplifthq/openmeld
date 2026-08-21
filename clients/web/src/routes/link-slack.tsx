import { Button, buttonVariants } from "@openmeld/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@openmeld/ui/components/card";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

function slackIdentityLinkPreviewQueryKey(token: string | null) {
	return ["slack-identity-link", "preview", token] as const;
}

function resolveSlackSetupTitle(
	preview: SlackSetupPreview | undefined
): string {
	if (!preview) {
		return "Join OpenMeld";
	}
	if (preview.replacesExistingLink) {
		return "Move your Slack account";
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
	const slackAccount =
		preview.slackAccountEmail ?? `@${preview.slackDisplayName}`;
	if (preview.replacesExistingLink) {
		const continuation = preview.continuesRequest
			? " OpenMeld will then continue your original request automatically."
			: "";
		return `Slack account ${slackAccount} is connected to another OpenMeld profile. Continue to move it to ${openMeldAccount}; the previous profile will lose this connection.${continuation}`;
	}
	if (preview.alreadyMember) {
		return preview.continuesRequest
			? `Connect Slack account ${slackAccount} to ${openMeldAccount} and continue your request.`
			: `Connect Slack account ${slackAccount} to ${openMeldAccount}.`;
	}
	return preview.continuesRequest
		? `Join ${preview.organizationName} as ${openMeldAccount}, connect Slack account ${slackAccount}, and continue your request.`
		: `Join ${preview.organizationName} as ${openMeldAccount} and connect Slack account ${slackAccount}.`;
}

function resolveSlackSetupButtonLabel(input: {
	alreadyMember: boolean;
	continuesRequest: boolean;
	pending: boolean;
	replacesExistingLink: boolean;
}): string {
	if (input.pending) {
		return "Setting you up...";
	}
	if (input.replacesExistingLink) {
		return input.continuesRequest
			? "Move to my account and continue"
			: "Move to my account";
	}
	if (!input.continuesRequest) {
		return input.alreadyMember ? "Connect my account" : "Join and connect";
	}
	return input.alreadyMember
		? "Connect my account and continue"
		: "Join and continue";
}

function resolveSlackSetupCompletionMessage(
	result: SlackSetupResult,
	continuesRequest: boolean
): string {
	if (!continuesRequest) {
		return result.replacedExistingLink
			? "Your Slack account was moved and is now connected here. You can return to Slack now."
			: "Your Slack account is connected. You can return to Slack now.";
	}
	if (result.continued) {
		return "I'm continuing your original request in the same Slack thread now.";
	}
	if (result.continuationRetryable) {
		return "Your Slack account is connected, but I couldn't continue the request yet. Try continuing again.";
	}
	return result.replacedExistingLink
		? "Your Slack account was moved and is now connected here. Return to Slack now."
		: "Your Slack account is connected. This older setup link cannot continue the request. Return to the original Slack thread and ask for a new setup button—you do not need to repeat your request.";
}

function SlackSetupCompleted(input: {
	continuesRequest: boolean;
	error: unknown;
	isPending: boolean;
	onRetry: () => void;
	result: SlackSetupResult;
}) {
	const openMeldProfilePath =
		input.result.organizationSlug && input.result.openMeldProfileId
			? `/o/${encodeURIComponent(input.result.organizationSlug)}/people?profileId=${encodeURIComponent(input.result.openMeldProfileId)}`
			: "/";
	return (
		<div className="space-y-3">
			<p className="font-medium text-foreground text-sm">You're ready.</p>
			<p className="text-muted-foreground text-sm">
				{resolveSlackSetupCompletionMessage(
					input.result,
					input.continuesRequest
				)}
			</p>
			{input.error ? (
				<p className="text-destructive text-sm">
					{resolveCenterAgentErrorMessage(input.error, "slack_link_consume")}
				</p>
			) : null}
			{input.result.continuationRetryable || openMeldProfilePath ? (
				<div className="flex flex-wrap gap-2">
					{input.result.continuationRetryable ? (
						<Button
							disabled={input.isPending}
							onClick={input.onRetry}
							type="button"
						>
							{input.isPending ? "Continuing..." : "Try continuing again"}
						</Button>
					) : null}
					{input.result.slackThreadPermalink ? (
						<a
							className={buttonVariants()}
							href={input.result.slackThreadPermalink}
							rel="noreferrer"
							target="_blank"
						>
							Open Slack thread
						</a>
					) : null}
					<a
						className={buttonVariants({
							variant: input.result.slackThreadPermalink
								? "outline"
								: "default",
						})}
						href={openMeldProfilePath}
					>
						View my OpenMeld profile
					</a>
				</div>
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
	const queryClient = useQueryClient();
	const sessionQuery = useAuthSession();
	const previewQuery = useQuery({
		enabled: Boolean(input.token),
		queryFn: async () => {
			if (!input.token) {
				throw new Error("Slack link token is missing.");
			}
			return await previewSlackIdentityLink({ token: input.token });
		},
		queryKey: slackIdentityLinkPreviewQueryKey(input.token),
		retry: false,
	});
	const consumeMutation = useMutation({
		mutationFn: async () => {
			if (!input.token) {
				throw new Error("Slack link token is missing.");
			}
			return await consumeSlackIdentityLink({
				includeReturnTarget: true,
				token: input.token,
			});
		},
		onSuccess: async (result) => {
			setCompletedSetup(result);
			await queryClient.invalidateQueries({
				exact: true,
				queryKey: slackIdentityLinkPreviewQueryKey(input.token),
				refetchType: "none",
			});
		},
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
								{preview.slackAccountEmail ?? `@${preview.slackDisplayName}`}
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
								replacesExistingLink: preview.replacesExistingLink,
							})}
						</Button>
					</div>
				) : null}
			</CardContent>
		</Card>
	);
}
