import { normalizeSpacePasswordText } from "@openmeld/schemas";
import type { GetSpaceEntryResolutionResponse } from "@openmeld/schemas/types";
import { Bars } from "@openmeld/ui/components/bars";
import { Button, buttonVariants } from "@openmeld/ui/components/button";
import { Input } from "@openmeld/ui/components/input";
import { Label } from "@openmeld/ui/components/label";
import {
	ArrowLeftIcon,
	LockKeyIcon,
	SignInIcon,
	UserPlusIcon,
	WarningCircleIcon,
} from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { isSessionExpiredError } from "#/lib/session-expired";
import { isCurrentSpaceAccessRejection } from "#/lib/spaces/errors";
import { rememberProtectedSpaceAccess } from "#/lib/spaces/protected-space-access";
import { spaceEntryResolutionQueryOptions } from "#/query/spaces/entry-resolution";
import {
	SpaceEntryConfirmationContext,
	SpaceEntryRetryContext,
} from "./space-entry-confirmation";

export function SpaceEntryGate(input: {
	backHref?: string;
	children: (resolution: GetSpaceEntryResolutionResponse) => ReactNode;
	/** Already identity-scoped, display-only app content; never used by public entry. */
	restoredContent?: ReactNode;
	onAccessRejected?: () => void;
	openMeldProfileId?: string;
	renderFrame: (content: ReactNode) => ReactNode;
	signalId?: string;
	signInHref: string;
	spaceId: string;
	threadRootSignalId?: string;
}) {
	const [password, setPassword] = useState("");
	const queryClient = useQueryClient();
	const [passwordError, setPasswordError] = useState<string | null>(null);
	const [isSubmittingPassword, setIsSubmittingPassword] = useState(false);
	const queryInput = {
		spaceId: input.spaceId,
		...(input.openMeldProfileId === undefined
			? {}
			: { openMeldProfileId: input.openMeldProfileId }),
		...(input.signalId === undefined ? {} : { signalId: input.signalId }),
		...(input.threadRootSignalId === undefined
			? {}
			: { threadRootSignalId: input.threadRootSignalId }),
	};
	const resolutionOptions = spaceEntryResolutionQueryOptions({
		...queryInput,
		enabled: typeof window !== "undefined",
	});
	const resolutionQuery = useQuery(resolutionOptions);
	const retryAccess = async () => {
		// Refetch alone shares an unfinished first request. Explicit retry must
		// replace it, without releasing actions until the resolver confirms access.
		await queryClient.cancelQueries({
			queryKey: resolutionOptions.queryKey,
			exact: true,
		});
		await resolutionQuery.refetch();
	};

	const rejected =
		(resolutionQuery.data !== undefined &&
			resolutionQuery.data.view.state !== "allowed") ||
		isSessionExpiredError(resolutionQuery.error) ||
		isCurrentSpaceAccessRejection(resolutionQuery.error);
	useEffect(() => {
		if (rejected) {
			input.onAccessRejected?.();
		}
	}, [rejected, input.onAccessRejected]);
	if (!rejected && resolutionQuery.data?.view.state === "allowed") {
		return (
			<SpaceEntryConfirmationContext value={true}>
				<SpaceEntryRetryContext value={null}>
					{input.children(resolutionQuery.data)}
				</SpaceEntryRetryContext>
			</SpaceEntryConfirmationContext>
		);
	}

	if (!(rejected || resolutionQuery.data) && input.restoredContent) {
		return (
			<SpaceEntryConfirmationContext value={false}>
				<SpaceEntryRetryContext
					value={{ retry: retryAccess, isError: resolutionQuery.isError }}
				>
					{input.restoredContent}
				</SpaceEntryRetryContext>
			</SpaceEntryConfirmationContext>
		);
	}

	const retry = () => {
		setPasswordError(null);
		retryAccess().catch((error: unknown) => {
			console.error("Failed to check Space access.", error);
		});
	};
	const submitPassword = async () => {
		const normalizedPassword = normalizeSpacePasswordText(password);
		if (normalizedPassword.length === 0) {
			setPasswordError("Enter the Space password.");
			return;
		}
		setIsSubmittingPassword(true);
		setPasswordError(null);
		try {
			await rememberProtectedSpaceAccess({
				data: { password: normalizedPassword, spaceId: input.spaceId },
			});
			const refreshed = await resolutionQuery.refetch();
			if (refreshed.data?.view.state === "password_required") {
				setPasswordError("That password isn't correct.");
			}
		} catch (error) {
			console.error("Failed to check the Space password.", error);
			setPasswordError("OpenMeld couldn't check that password right now.");
		} finally {
			setIsSubmittingPassword(false);
		}
	};

	return input.renderFrame(
		<SpaceEntryState
			backHref={input.backHref}
			errorMessage={resolutionQuery.error?.message ?? null}
			isPending={resolutionQuery.isPending}
			isRetrying={resolutionQuery.isRefetching}
			onPasswordChange={(value) => {
				setPassword(value);
				setPasswordError(null);
			}}
			onPasswordSubmit={submitPassword}
			onRetry={retry}
			password={password}
			passwordError={passwordError}
			passwordIsSubmitting={isSubmittingPassword}
			resolution={resolutionQuery.data ?? null}
			signInHref={input.signInHref}
		/>
	);
}

export function SpaceEntryState(input: {
	backHref?: string;
	errorMessage: string | null;
	isPending: boolean;
	isRetrying: boolean;
	onPasswordChange: (value: string) => void;
	onPasswordSubmit: () => Promise<void>;
	onRetry: () => void;
	password: string;
	passwordError: string | null;
	passwordIsSubmitting: boolean;
	resolution: GetSpaceEntryResolutionResponse | null;
	signInHref: string;
}) {
	if (input.isPending && !input.resolution) {
		return (
			<output
				aria-label="Checking Space access"
				className="flex w-full max-w-sm flex-col items-center gap-4 text-center"
			>
				<Bars aria-hidden="true" className="h-7 w-10 text-muted-foreground" />
				<div className="space-y-2">
					<h1 className="font-medium text-base">Checking Space access</h1>
					<p className="text-muted-foreground text-sm">
						OpenMeld is checking what this account can view and do here.
					</p>
				</div>
				<Button onClick={input.onRetry} size="sm" variant="outline">
					Check again
				</Button>
			</output>
		);
	}

	if (input.errorMessage || !input.resolution) {
		return (
			<EntryStateLayout
				action={
					<Button
						disabled={input.isRetrying}
						onClick={input.onRetry}
						type="button"
						variant="outline"
					>
						{input.isRetrying ? "Checking…" : "Try again"}
					</Button>
				}
				description="OpenMeld couldn't confirm access to this Space."
				icon={<WarningCircleIcon aria-hidden="true" />}
				title="Couldn't check Space access"
			/>
		);
	}

	const { resolution } = input;
	if (resolution.view.state === "sign_in_required") {
		return (
			<EntryStateLayout
				action={
					<a className={buttonVariants()} href={input.signInHref}>
						<SignInIcon aria-hidden="true" />
						Sign in
					</a>
				}
				description="Sign in to confirm whether you can open this Space."
				icon={<SignInIcon aria-hidden="true" />}
				title="Sign in to continue"
			/>
		);
	}

	if (resolution.view.state === "password_required") {
		return (
			<EntryStateLayout
				action={
					<form
						className="flex w-full flex-col gap-3"
						onSubmit={(event) => {
							event.preventDefault();
							input.onPasswordSubmit().catch((error: unknown) => {
								console.error("Failed to unlock Space.", error);
							});
						}}
					>
						<div className="flex flex-col gap-2 text-left">
							<Label htmlFor="space-entry-password">Space password</Label>
							<Input
								autoComplete="current-password"
								id="space-entry-password"
								onChange={(event) => input.onPasswordChange(event.target.value)}
								type="password"
								value={input.password}
							/>
						</div>
						{input.passwordError ? (
							<p className="text-destructive text-sm" role="alert">
								{input.passwordError}
							</p>
						) : null}
						<Button disabled={input.passwordIsSubmitting} type="submit">
							{input.passwordIsSubmitting ? "Checking…" : "View Space"}
						</Button>
					</form>
				}
				description="Enter the password to view this Space."
				icon={<LockKeyIcon aria-hidden="true" />}
				title="This Space requires a password"
			/>
		);
	}

	if (resolution.view.state === "membership_required") {
		const spaceName = resolution.safeContext.spaceName ?? "this Space";
		const ownerName = resolution.safeContext.owner?.displayName;
		return (
			<EntryStateLayout
				action={
					input.backHref ? (
						<a
							className={buttonVariants({ variant: "outline" })}
							href={input.backHref}
						>
							<ArrowLeftIcon aria-hidden="true" />
							Back to Spaces
						</a>
					) : null
				}
				description={
					ownerName
						? `Ask ${ownerName} to add you to this Space.`
						: "Ask a Space owner to add you."
				}
				icon={<UserPlusIcon aria-hidden="true" />}
				title={`You don't have access to ${spaceName}`}
			/>
		);
	}

	return (
		<EntryStateLayout
			action={
				input.backHref ? (
					<a
						className={buttonVariants({ variant: "outline" })}
						href={input.backHref}
					>
						<ArrowLeftIcon aria-hidden="true" />
						Back to Spaces
					</a>
				) : null
			}
			description="It may have been removed, or this account may not have access."
			icon={<WarningCircleIcon aria-hidden="true" />}
			title="This Space isn't available"
		/>
	);
}

function EntryStateLayout(input: {
	action: ReactNode;
	description: string;
	icon: ReactNode;
	title: string;
}) {
	return (
		<section
			aria-labelledby="space-entry-state-title"
			className="flex w-full max-w-md flex-col items-center text-center"
		>
			<div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-5">
				{input.icon}
			</div>
			<h1
				className="mt-4 font-medium text-base text-foreground"
				id="space-entry-state-title"
			>
				{input.title}
			</h1>
			<p className="mt-2 max-w-sm text-muted-foreground text-sm">
				{input.description}
			</p>
			{input.action ? <div className="mt-5 w-full">{input.action}</div> : null}
		</section>
	);
}
