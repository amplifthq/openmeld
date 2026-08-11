import { Button } from "@openmeld/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@openmeld/ui/components/card";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod/v4";
import { AuthPageShell } from "#/components/auth/auth-page-shell";
import { useAuthSession } from "#/hooks/auth.hooks";
import { getSession } from "#/lib/auth-session";
import {
	consumeMessageChannelIdentityLink,
	previewMessageChannelIdentityLink,
	resolveMessageChannelErrorMessage,
} from "#/lib/organizations/message-channels";

const linkMessageChannelSearchSchema = z.object({
	token: z.string().trim().min(1).optional(),
});

type LinkMessageChannelSearch = {
	token?: string;
};

export const Route = createFileRoute("/link-message-channel")({
	validateSearch: (search): LinkMessageChannelSearch => {
		const parsed = linkMessageChannelSearchSchema.safeParse(search);
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
	component: LinkMessageChannelRoute,
});

function LinkMessageChannelRoute() {
	const search = Route.useSearch();
	return (
		<AuthPageShell>
			<LinkMessageChannelCard token={search.token ?? null} />
		</AuthPageShell>
	);
}

export function LinkMessageChannelCard(input: { token: string | null }) {
	const sessionQuery = useAuthSession();
	const queryClient = useQueryClient();
	const consumeMutation = useMutation({
		mutationFn: async () => {
			if (!input.token) {
				throw new Error("Message Channel link token is missing.");
			}
			return await consumeMessageChannelIdentityLink({ token: input.token });
		},
		onSuccess: () => {
			queryClient.removeQueries({
				exact: true,
				queryKey: messageChannelIdentityLinkPreviewQueryKey(input.token),
			});
		},
	});
	const previewQuery = useQuery({
		enabled: Boolean(input.token) && !consumeMutation.isSuccess,
		queryFn: async () => {
			if (!input.token) {
				throw new Error("Message Channel link token is missing.");
			}
			return await previewMessageChannelIdentityLink({ token: input.token });
		},
		queryKey: messageChannelIdentityLinkPreviewQueryKey(input.token),
		retry: false,
	});

	const preview = previewQuery.data;
	const providerName = providerLabel(
		consumeMutation.data?.provider ?? preview?.provider
	);
	const accountEmail =
		preview?.openMeldAccountEmail ?? sessionQuery.data?.user.email ?? null;

	return (
		<Card className="w-full max-w-md">
			<CardHeader>
				<CardTitle>
					{preview ? resolveSetupTitle(preview, providerName) : "Join OpenMeld"}
				</CardTitle>
				<CardDescription>
					{preview?.continuesRequest
						? "Connect the Message Channel and OpenMeld accounts shown below. The Center Agent will then continue your original request in the same conversation."
						: "Check both accounts below, then connect them."}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{input.token ? null : (
					<p className="text-destructive text-sm">
						This account link is missing a token. Go back to Lark or Feishu and
						ask the Center Agent again.
					</p>
				)}
				{input.token && previewQuery.isPending ? (
					<p className="text-muted-foreground text-sm">
						Checking this account link.
					</p>
				) : null}
				{previewQuery.isError ? (
					<p className="text-destructive text-sm">
						{resolveMessageChannelErrorMessage(
							previewQuery.error,
							"This account link could not be verified."
						)}
					</p>
				) : null}
				{consumeMutation.data ? (
					<MessageChannelSetupCompleted
						isPending={consumeMutation.isPending}
						onRetry={() => consumeMutation.mutate()}
						providerName={providerName}
						result={consumeMutation.data}
					/>
				) : null}
				{preview && !consumeMutation.isSuccess ? (
					<div className="space-y-4">
						<div className="space-y-2 border border-border/70 bg-card/30 p-3">
							<p className="text-muted-foreground text-xs">
								{providerName} account
							</p>
							<p className="font-medium text-foreground text-sm">
								{preview.providerUserDisplayName}
							</p>
						</div>
						<div className="space-y-2 border border-border/70 bg-card/30 p-3">
							<p className="text-muted-foreground text-xs">OpenMeld account</p>
							<p className="font-medium text-foreground text-sm">
								{accountEmail ?? "Current account"}
							</p>
							<p className="text-muted-foreground text-xs">
								Organization: {preview.organizationName}
							</p>
						</div>
						<p className="text-muted-foreground text-sm">
							{resolveSetupSummary({
								accountEmail,
								preview,
								providerName,
							})}
						</p>
						{consumeMutation.isError ? (
							<p className="text-destructive text-sm">
								{resolveMessageChannelErrorMessage(
									consumeMutation.error,
									"This account could not be linked."
								)}
							</p>
						) : null}
						<Button
							disabled={consumeMutation.isPending}
							onClick={() => consumeMutation.mutate()}
							type="button"
						>
							{consumeMutation.isPending
								? "Setting you up..."
								: resolveSetupButtonLabel(preview)}
						</Button>
					</div>
				) : null}
			</CardContent>
		</Card>
	);
}

type MessageChannelSetupPreview = Awaited<
	ReturnType<typeof previewMessageChannelIdentityLink>
>;
type MessageChannelSetupResult = Awaited<
	ReturnType<typeof consumeMessageChannelIdentityLink>
>;

function MessageChannelSetupCompleted(input: {
	isPending: boolean;
	onRetry: () => void;
	providerName: "Feishu" | "Lark" | null;
	result: MessageChannelSetupResult;
}) {
	return (
		<div className="space-y-3">
			<p className="font-medium text-foreground text-sm">You're ready.</p>
			<p className="text-muted-foreground text-sm">
				{resolveSetupCompletionMessage({
					continuesRequest: input.result.continuesRequest,
					providerName: input.providerName,
					result: input.result,
				})}
			</p>
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

function resolveSetupTitle(
	preview: MessageChannelSetupPreview,
	providerName: "Feishu" | "Lark" | null
): string {
	if (preview.alreadyMember) {
		return `Connect your ${providerName ?? "Message Channel"} account`;
	}
	return `Join ${preview.organizationName} and connect ${providerName ?? "this account"}`;
}

function resolveSetupSummary(input: {
	accountEmail: string | null;
	preview: MessageChannelSetupPreview;
	providerName: "Feishu" | "Lark" | null;
}): string {
	const providerName = input.providerName ?? "Message Channel";
	const account = input.accountEmail ?? "this OpenMeld account";
	const continuation = input.preview.continuesRequest
		? " OpenMeld will then continue your original request automatically."
		: "";
	if (input.preview.alreadyMember) {
		return `Connect ${input.preview.providerUserDisplayName} on ${providerName} to ${account}.${continuation}`;
	}
	return `Join ${input.preview.organizationName} as ${account} and connect ${input.preview.providerUserDisplayName} on ${providerName}.${continuation}`;
}

function resolveSetupButtonLabel(preview: MessageChannelSetupPreview): string {
	if (!preview.continuesRequest) {
		return preview.alreadyMember ? "Connect my account" : "Join and connect";
	}
	return preview.alreadyMember
		? "Connect my account and continue"
		: "Join and continue";
}

function resolveSetupCompletionMessage(input: {
	continuesRequest: boolean;
	providerName: "Feishu" | "Lark" | null;
	result: MessageChannelSetupResult;
}): string {
	const providerName = input.providerName ?? "your Message Channel";
	if (!input.continuesRequest) {
		return `Your account is connected. You can return to ${providerName} now.`;
	}
	if (input.result.continued) {
		return `The Center Agent is continuing your original request in ${providerName} now.`;
	}
	if (input.result.continuationRetryable) {
		return `Your account is connected, but OpenMeld could not continue the request yet. Return to ${providerName}; you do not need to repeat the original request.`;
	}
	return `Your account is connected. Return to ${providerName}; you do not need to repeat the original request.`;
}

function messageChannelIdentityLinkPreviewQueryKey(token: string | null) {
	return ["message-channel-identity-link", "preview", token] as const;
}

function providerLabel(
	provider: "feishu" | "lark" | undefined
): "Feishu" | "Lark" | null {
	if (!provider) {
		return null;
	}
	return provider === "feishu" ? "Feishu" : "Lark";
}
