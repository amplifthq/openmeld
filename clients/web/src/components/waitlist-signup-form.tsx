"use client";

import { Input } from "@openmeld/ui/components/input";
import { Label } from "@openmeld/ui/components/label";
import { useState } from "react";
import { toast } from "sonner";
import { toAriaInvalid } from "../lib/form-error";
import {
	getWaitlistRateLimitRemainingMs,
	markWaitlistSubmitted,
	submitWaitlistEmail,
	validateWaitlistEmail,
} from "../lib/waitlist";
import { SpinnerButton } from "./spinner-button";

const RATE_LIMIT_ERROR_MESSAGE =
	"Please wait 3 minutes before trying this email again.";
const SUCCESS_MESSAGE = "You're on the waitlist.";
const DUPLICATE_MESSAGE = "You're already on the waitlist.";
const REQUEST_ERROR_MESSAGE = "Failed to join the waitlist.";

type WaitlistFieldErrors = {
	email?: string;
};

export function WaitlistSignupForm() {
	const [email, setEmail] = useState("");
	const [fieldErrors, setFieldErrors] = useState<WaitlistFieldErrors>({});
	const [isSubmitting, setIsSubmitting] = useState(false);

	async function handleSubmit() {
		const parseResult = validateWaitlistEmail(email);
		if (!parseResult.success) {
			setFieldErrors({
				email: parseResult.error.flatten().fieldErrors.email?.[0],
			});
			return;
		}

		const normalizedEmail = parseResult.data.email;
		const remainingMs = getWaitlistRateLimitRemainingMs(normalizedEmail);
		if (remainingMs > 0) {
			toast.error(RATE_LIMIT_ERROR_MESSAGE);
			return;
		}

		setFieldErrors({});
		setIsSubmitting(true);

		try {
			const result = await submitWaitlistEmail({
				email: normalizedEmail,
			});
			markWaitlistSubmitted(normalizedEmail);
			setEmail("");

			if (result.status === "created") {
				toast.success(SUCCESS_MESSAGE);
				return;
			}

			toast(DUPLICATE_MESSAGE);
		} catch (error) {
			const message =
				error instanceof Error && error.message.trim()
					? error.message
					: REQUEST_ERROR_MESSAGE;
			toast.error(message);
		} finally {
			setIsSubmitting(false);
		}
	}

	return (
		<div className="mt-18 w-full max-w-md space-y-2">
			<Label className="sr-only" htmlFor="waitlist-email">
				Email
			</Label>
			<form
				className="flex w-full flex-col gap-2 sm:flex-row"
				onSubmit={(event) => {
					event.preventDefault();
					handleSubmit().catch(() => {
						toast.error(REQUEST_ERROR_MESSAGE);
						setIsSubmitting(false);
					});
				}}
			>
				<Input
					aria-invalid={toAriaInvalid(fieldErrors.email)}
					autoComplete="email"
					className="h-10 font-mono text-xs sm:text-sm"
					disabled={isSubmitting}
					id="waitlist-email"
					onChange={(event) => {
						setEmail(event.target.value);
						if (fieldErrors.email) {
							setFieldErrors({ email: undefined });
						}
					}}
					placeholder="you@company.com"
					type="email"
					value={email}
				/>
				<SpinnerButton
					buttonState={isSubmitting ? "loading" : "idle"}
					className="h-10 px-4 font-mono sm:w-auto"
					isLoading={isSubmitting}
					type="submit"
					variant="secondary"
				>
					Join the waitlist
				</SpinnerButton>
			</form>
			{fieldErrors.email ? (
				<p className="text-center text-destructive text-xs">
					{fieldErrors.email}
				</p>
			) : (
				<p className="text-center text-muted-foreground text-xs">
					Get notified when we launch a public beta.
				</p>
			)}
		</div>
	);
}
