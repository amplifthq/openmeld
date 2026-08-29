import {
	betterAuthDeviceAuthorizationClaimResponseSchema,
	betterAuthDeviceAuthorizationDecisionRequestSchema,
	betterAuthDeviceAuthorizationDecisionResponseSchema,
} from "@openmeld/schemas";
import { Button, buttonVariants } from "@openmeld/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@openmeld/ui/components/card";
import { Input } from "@openmeld/ui/components/input";
import { Label } from "@openmeld/ui/components/label";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { parseAsString, useQueryState } from "nuqs";
import { toast } from "sonner";

type UiMessage = {
	text: string;
	tone: "default" | "error";
};

type DeviceDecisionInput = {
	outcome: "approved" | "denied";
	path: "/api/auth/device/approve" | "/api/auth/device/deny";
	successText: string;
	userCode: string;
};

type DeviceRequestStatus = "approved" | "denied" | "pending";

const APPROVE_SUCCESS_TEXT = "Device approved. You can return to CLI.";
const DECISION_FAILED_TEXT =
	"OpenMeld couldn't update this device request. Check your connection and try again.";
const INVALID_CODE_TEXT =
	"This device code is invalid or has expired. Start sign-in again from the CLI.";
const REQUEST_UNAVAILABLE_TEXT =
	"This device request is no longer available. Start sign-in again from the CLI.";
const SESSION_EXPIRED_TEXT =
	"Your OpenMeld session has expired. Sign in again, then reopen this device link from the CLI.";
const VERIFICATION_FAILED_TEXT =
	"OpenMeld couldn't verify this device request. Check your connection and try again.";
const USER_CODE_REPLACE_PATTERN = /[^a-zA-Z0-9]/g;
const USER_CODE_MAX_LENGTH = 32;

function normalizeUserCode(value: string): string {
	return value.trim().replace(USER_CODE_REPLACE_PATTERN, "").toUpperCase();
}

function getDeviceClaimQueryKey(userCode: string) {
	return ["device-authorization", "claim", userCode] as const;
}

function getErrorMessage(error: unknown, fallback: string): string {
	return error instanceof Error && error.message ? error.message : fallback;
}

function getDeviceRequestErrorMessage(
	response: Response,
	operation: "verify" | "decide"
): string {
	if (response.status === 401) {
		return SESSION_EXPIRED_TEXT;
	}

	if (response.status === 403) {
		return "This device request belongs to another OpenMeld account. Sign in with the account that started it, or restart sign-in from the CLI.";
	}

	if (response.status === 400) {
		return operation === "verify"
			? INVALID_CODE_TEXT
			: REQUEST_UNAVAILABLE_TEXT;
	}

	return operation === "verify"
		? VERIFICATION_FAILED_TEXT
		: "OpenMeld couldn't update this device request. Check your connection and try again.";
}

async function getDeviceRequestStatus(
	response: Response
): Promise<DeviceRequestStatus | null> {
	try {
		const parsed = betterAuthDeviceAuthorizationClaimResponseSchema.safeParse(
			await response.json()
		);
		return parsed.success ? parsed.data.status : null;
	} catch {
		return null;
	}
}

async function claimDeviceRequest(
	userCode: string,
	signal: AbortSignal
): Promise<DeviceRequestStatus> {
	const response = await fetch(
		`/api/auth/device?user_code=${encodeURIComponent(userCode)}`,
		{
			credentials: "include",
			method: "GET",
			signal,
		}
	);

	if (!response.ok) {
		throw new Error(getDeviceRequestErrorMessage(response, "verify"));
	}

	const status = await getDeviceRequestStatus(response);
	if (status === "pending") {
		return status;
	}

	throw new Error(
		status === "approved" || status === "denied"
			? REQUEST_UNAVAILABLE_TEXT
			: VERIFICATION_FAILED_TEXT
	);
}

async function submitDeviceDecision(
	input: DeviceDecisionInput
): Promise<DeviceDecisionInput> {
	const parsedRequest =
		betterAuthDeviceAuthorizationDecisionRequestSchema.safeParse({
			userCode: input.userCode,
		});
	if (!parsedRequest.success) {
		throw new Error(DECISION_FAILED_TEXT, { cause: parsedRequest.error });
	}
	const response = await fetch(input.path, {
		body: JSON.stringify(parsedRequest.data),
		credentials: "include",
		headers: {
			"content-type": "application/json",
		},
		method: "POST",
	});

	if (!response.ok) {
		throw new Error(getDeviceRequestErrorMessage(response, "decide"));
	}
	const parsed = betterAuthDeviceAuthorizationDecisionResponseSchema.safeParse(
		await response.json()
	);
	if (!(parsed.success && parsed.data.success)) {
		throw new Error(DECISION_FAILED_TEXT);
	}

	return input;
}

export const Route = createFileRoute("/device/approve")({
	component: DeviceApprovePage,
});

function DeviceApprovePage() {
	const [queryUserCode, setQueryUserCode] = useQueryState(
		"user_code",
		parseAsString.withDefault("").withOptions({ history: "replace" })
	);
	const userCode = normalizeUserCode(queryUserCode).slice(
		0,
		USER_CODE_MAX_LENGTH
	);
	const queryClient = useQueryClient();
	const deviceRequestQuery = useQuery({
		enabled: Boolean(userCode),
		gcTime: 0,
		queryFn: ({ signal }) => claimDeviceRequest(userCode, signal),
		queryKey: getDeviceClaimQueryKey(userCode),
		refetchOnReconnect: false,
		refetchOnWindowFocus: false,
		retry: false,
		staleTime: 0,
	});
	const decisionMutation = useMutation({
		mutationFn: submitDeviceDecision,
		onError: (error) => {
			toast.error(getErrorMessage(error, DECISION_FAILED_TEXT));
		},
		onSuccess: (decision) => {
			queryClient.setQueryData(
				getDeviceClaimQueryKey(decision.userCode),
				decision.outcome
			);
			toast.success(decision.successText);
		},
	});

	let message: UiMessage;
	if (!userCode) {
		message = {
			text: "Enter the user code shown in your CLI.",
			tone: "error",
		};
	} else if (decisionMutation.isSuccess) {
		message = {
			text: decisionMutation.data.successText,
			tone: "default",
		};
	} else if (decisionMutation.isError) {
		message = {
			text: getErrorMessage(decisionMutation.error, DECISION_FAILED_TEXT),
			tone: "error",
		};
	} else if (deviceRequestQuery.isPending || deviceRequestQuery.isFetching) {
		message = {
			text: "Checking this device request…",
			tone: "default",
		};
	} else if (deviceRequestQuery.isError) {
		message = {
			text: getErrorMessage(deviceRequestQuery.error, VERIFICATION_FAILED_TEXT),
			tone: "error",
		};
	} else {
		message = {
			text: "Device request verified. Approve it only if you started this sign-in.",
			tone: "default",
		};
	}

	const canSubmitDecision =
		deviceRequestQuery.data === "pending" &&
		!deviceRequestQuery.isFetching &&
		!decisionMutation.isPending &&
		!decisionMutation.isSuccess &&
		!decisionMutation.isError;
	const canRetry =
		Boolean(userCode) &&
		(deviceRequestQuery.isError || decisionMutation.isError);

	return (
		<Card>
			<CardHeader>
				<CardTitle>Approve Device</CardTitle>
				<CardDescription>
					Authorize or deny this device login request from your CLI.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="space-y-2">
					<Label className="block text-center">User Code</Label>
					<Input
						className="h-11 text-center font-geist-pixel-square text-base uppercase"
						maxLength={USER_CODE_MAX_LENGTH}
						onChange={(event) => {
							const nextUserCode = normalizeUserCode(event.target.value).slice(
								0,
								USER_CODE_MAX_LENGTH
							);
							decisionMutation.reset();
							setQueryUserCode(nextUserCode).catch(() => undefined);
						}}
						placeholder="ABCD1234"
						spellCheck={false}
						type="text"
						value={userCode}
					/>
				</div>

				<p
					className={
						message.tone === "error"
							? "text-destructive text-xs"
							: "text-muted-foreground text-xs"
					}
				>
					{message.text}
				</p>

				{canRetry ? (
					<Button
						className="w-full"
						onClick={() => {
							decisionMutation.reset();
							deviceRequestQuery.refetch().catch(() => undefined);
						}}
						type="button"
						variant="outline"
					>
						Try again
					</Button>
				) : null}

				<div className="flex w-full gap-2">
					<Button
						className="flex-1"
						disabled={!canSubmitDecision}
						onClick={() =>
							decisionMutation.mutate({
								outcome: "approved",
								path: "/api/auth/device/approve",
								successText: APPROVE_SUCCESS_TEXT,
								userCode,
							})
						}
						type="button"
					>
						Approve
					</Button>
					<Button
						className="flex-1"
						disabled={!canSubmitDecision}
						onClick={() =>
							decisionMutation.mutate({
								outcome: "denied",
								path: "/api/auth/device/deny",
								successText: "Device request denied.",
								userCode,
							})
						}
						type="button"
						variant="outline"
					>
						Deny
					</Button>
				</div>

				<div className="flex w-full flex-wrap justify-between gap-2">
					<Link className={buttonVariants({ variant: "outline" })} to="/">
						Back
					</Link>
					{decisionMutation.data?.outcome === "approved" ? (
						<Link className={buttonVariants()} to="/login">
							Go to OpenMeld
						</Link>
					) : null}
				</div>
			</CardContent>
		</Card>
	);
}
