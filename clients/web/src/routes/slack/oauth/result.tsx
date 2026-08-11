import { slackOAuthErrorCodeSchema } from "@openmeld/schemas";
import type { SlackOAuthErrorCode } from "@openmeld/schemas/types";
import { buttonVariants } from "@openmeld/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@openmeld/ui/components/card";
import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod/v4";
import { AuthPageShell } from "#/components/auth/auth-page-shell";
import { resolveSlackOAuthResultMessage } from "#/lib/organizations/slack-oauth-result";

const slackOAuthResultSearchSchema = z.object({
	slack_oauth: z.literal("error").optional(),
	slack_oauth_error: slackOAuthErrorCodeSchema.optional(),
});

export const Route = createFileRoute("/slack/oauth/result")({
	validateSearch: (search) => {
		const parsed = slackOAuthResultSearchSchema.safeParse(search);
		return parsed.success ? parsed.data : {};
	},
	component: SlackOAuthResultRoute,
});

function SlackOAuthResultRoute() {
	const search = Route.useSearch();
	return (
		<AuthPageShell>
			<SlackOAuthResultCard
				error={search.slack_oauth_error ?? "invalid_state"}
			/>
		</AuthPageShell>
	);
}

export function SlackOAuthResultCard(input: { error: SlackOAuthErrorCode }) {
	const message = resolveSlackOAuthResultMessage({
		error: input.error,
		status: "error",
	});
	return (
		<Card className="w-full max-w-md">
			<CardHeader>
				<CardTitle>{message.title}</CardTitle>
				<CardDescription>{message.description}</CardDescription>
			</CardHeader>
			<CardContent>
				<Link className={buttonVariants({ size: "sm" })} to="/">
					Return to OpenMeld
				</Link>
			</CardContent>
		</Card>
	);
}
