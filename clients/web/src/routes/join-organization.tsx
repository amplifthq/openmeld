import type { PreviewOrganizationJoinLinkResponse } from "@openmeld/schemas/types";
import { Button, buttonVariants } from "@openmeld/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@openmeld/ui/components/card";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	useLocation,
	useNavigate,
} from "@tanstack/react-router";
import { z } from "zod/v4";
import { AuthPageShell } from "#/components/auth/auth-page-shell";
import { useAuthSession } from "#/hooks/auth.hooks";
import {
	acceptOrganizationJoinLink,
	previewOrganizationJoinLink,
} from "#/lib/organizations/auth-organizations";
import { buildOrganizationDefaultPath } from "#/lib/organizations/organization-routes";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";

const joinOrganizationSearchSchema = z.object({
	token: z.string().trim().min(1).optional(),
});

type JoinOrganizationSearch = z.infer<typeof joinOrganizationSearchSchema>;

const EMAIL_VERIFICATION_REQUIRED_CODE =
	"organization.join_link.email_verification_required";

type AcceptState = "idle" | "pending" | "success";
type SessionState = "pending" | "signed-in" | "signed-out";

export const Route = createFileRoute("/join-organization")({
	component: JoinOrganizationRoute,
	validateSearch: (search): JoinOrganizationSearch => {
		const parsed = joinOrganizationSearchSchema.safeParse(search);
		return parsed.success ? parsed.data : {};
	},
});

function JoinOrganizationRoute() {
	const search = Route.useSearch();
	const locationHref = useLocation({ select: (location) => location.href });
	return (
		<JoinOrganizationPage
			locationHref={locationHref}
			token={search.token ?? null}
		/>
	);
}

export function JoinOrganizationPage(input: {
	locationHref: string;
	token: string | null;
}) {
	const sessionQuery = useAuthSession();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const previewQuery = useQuery({
		enabled: Boolean(input.token),
		queryFn: async () => {
			if (!input.token) {
				throw new Error("Organization invite link token is missing.");
			}
			return await previewOrganizationJoinLink({ token: input.token });
		},
		queryKey: ["organization-join-link", "preview", input.token],
		retry: false,
	});
	const openOrganizationMutation = useMutation({
		mutationFn: async (accepted: {
			organizationName: string;
			organizationSlug: string;
		}) => {
			await navigate({
				to: buildOrganizationDefaultPath(accepted.organizationSlug),
			});
		},
		onError: (error, accepted) => {
			console.error("OpenMeld joined the Organization but could not open it.", {
				error,
				organizationName: accepted.organizationName,
				organizationSlug: accepted.organizationSlug,
			});
		},
	});
	const acceptMutation = useMutation({
		mutationFn: async () => {
			if (!input.token) {
				throw new Error("Organization invite link token is missing.");
			}
			return await acceptOrganizationJoinLink({ token: input.token });
		},
		onSuccess: async (accepted) => {
			await queryClient.invalidateQueries({
				queryKey: organizationQueryKeys.all,
			});
			openOrganizationMutation.mutate(accepted);
		},
	});
	const acceptState = resolveAcceptState({
		isPending: acceptMutation.isPending,
		isSuccess: acceptMutation.isSuccess,
	});
	const sessionState = resolveSessionState({
		hasSession: Boolean(sessionQuery.data),
		isPending: sessionQuery.isPending,
	});
	const acceptJoinLink = acceptMutation.mutate;

	return (
		<AuthPageShell>
			<Card className="w-full max-w-md">
				<CardHeader>
					<CardTitle>{resolvePageTitle(previewQuery.data)}</CardTitle>
					<CardDescription>
						Join an organization and start working together in OpenMeld.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<JoinOrganizationBody
						acceptError={acceptMutation.error}
						acceptState={acceptState}
						locationHref={input.locationHref}
						onAccept={acceptJoinLink}
						onOpenOrganization={() => {
							if (acceptMutation.data) {
								openOrganizationMutation.mutate(acceptMutation.data);
							}
						}}
						openError={openOrganizationMutation.error}
						opening={openOrganizationMutation.isPending}
						preview={previewQuery.data ?? null}
						previewError={previewQuery.error}
						previewPending={previewQuery.isPending}
						sessionState={sessionState}
						token={input.token}
					/>
				</CardContent>
			</Card>
		</AuthPageShell>
	);
}

function JoinOrganizationBody(input: {
	acceptError: Error | null;
	acceptState: AcceptState;
	locationHref: string;
	onAccept: () => void;
	onOpenOrganization: () => void;
	openError: Error | null;
	opening: boolean;
	preview: PreviewOrganizationJoinLinkResponse | null;
	previewError: Error | null;
	previewPending: boolean;
	sessionState: SessionState;
	token: string | null;
}) {
	if (!input.token) {
		return (
			<p className="text-destructive text-sm">
				This invite link is missing its token.
			</p>
		);
	}
	if (input.previewPending) {
		return (
			<p className="text-muted-foreground text-sm">
				Checking this invite link.
			</p>
		);
	}
	if (input.previewError) {
		return (
			<p className="text-destructive text-sm">{input.previewError.message}</p>
		);
	}
	if (!input.preview?.active) {
		return (
			<p className="text-destructive text-sm">
				This invite link is no longer active. Ask an OpenMeld admin for a new
				one.
			</p>
		);
	}
	if (input.sessionState === "pending") {
		return (
			<p className="text-muted-foreground text-sm">
				Checking your sign-in status.
			</p>
		);
	}
	if (input.sessionState === "signed-out") {
		return (
			<div className="space-y-3">
				<p className="text-muted-foreground text-sm">
					Sign in to join {input.preview.organizationName} as a member.
				</p>
				<Link
					className={buttonVariants()}
					search={{ redirect: input.locationHref }}
					to="/login"
				>
					Sign in to join
				</Link>
			</div>
		);
	}
	if (
		readJoinLinkErrorCode(input.acceptError) ===
		EMAIL_VERIFICATION_REQUIRED_CODE
	) {
		return (
			<div className="space-y-3">
				<p className="text-muted-foreground text-sm">
					Your email address is not verified yet. Sign in once with a magic link
					to verify it, then you can join {input.preview.organizationName}.
				</p>
				<Link
					className={buttonVariants()}
					search={{ redirect: input.locationHref }}
					to="/login"
				>
					Continue with a magic link
				</Link>
			</div>
		);
	}
	if (input.acceptError) {
		return (
			<div className="space-y-3">
				<p className="text-destructive text-sm">{input.acceptError.message}</p>
				<Button onClick={input.onAccept} type="button">
					Try again
				</Button>
			</div>
		);
	}
	if (input.acceptState === "success" && input.openError) {
		return (
			<div className="space-y-3">
				<p className="text-destructive text-sm">
					You joined {input.preview.organizationName}, but OpenMeld could not
					open it.
				</p>
				<Button
					disabled={input.opening}
					onClick={input.onOpenOrganization}
					type="button"
				>
					{input.opening
						? "Opening..."
						: `Open ${input.preview.organizationName}`}
				</Button>
			</div>
		);
	}
	if (input.acceptState === "success") {
		return (
			<p className="text-muted-foreground text-sm">
				You are in. Opening {input.preview.organizationName}...
			</p>
		);
	}
	return (
		<div className="space-y-3">
			<p className="text-muted-foreground text-sm">
				You will join as a member.
			</p>
			<Button
				disabled={input.acceptState === "pending"}
				onClick={input.onAccept}
				type="button"
			>
				{input.acceptState === "pending"
					? "Joining..."
					: `Join ${input.preview.organizationName}`}
			</Button>
		</div>
	);
}

function resolvePageTitle(
	preview: PreviewOrganizationJoinLinkResponse | undefined
): string {
	return preview?.active
		? `Join ${preview.organizationName} on OpenMeld`
		: "Join an organization";
}

function readJoinLinkErrorCode(error: unknown): string | null {
	if (!error || typeof error !== "object") {
		return null;
	}
	const code = (error as { code?: unknown }).code;
	return typeof code === "string" ? code : null;
}

function resolveAcceptState(input: {
	isPending: boolean;
	isSuccess: boolean;
}): AcceptState {
	if (input.isPending) {
		return "pending";
	}
	return input.isSuccess ? "success" : "idle";
}

function resolveSessionState(input: {
	hasSession: boolean;
	isPending: boolean;
}): SessionState {
	if (input.isPending) {
		return "pending";
	}
	return input.hasSession ? "signed-in" : "signed-out";
}
