import { Input } from "@openmeld/ui/components/input";
import { Label } from "@openmeld/ui/components/label";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod/v4";
import { ClientAuthForm } from "#/components/auth/forms/client-auth-form";
import { SpinnerButton } from "#/components/spinner-button";
import { useMagicLinkSignIn } from "#/hooks/auth-form.hooks";
import { getAuthErrorMessage } from "#/lib/auth-errors";
import { toAriaInvalid } from "#/lib/form-error";

type MagicLinkFormProps = {
	className?: string;
	isSubmitting?: boolean;
	setIsSubmitting?: (isSubmitting: boolean) => void;
};

const magicLinkSchema = z.strictObject({
	email: z
		.string()
		.min(1, { message: "Email is required" })
		.email({ message: "Email is invalid" }),
});

export function MagicLinkForm({
	className,
	isSubmitting = false,
	setIsSubmitting,
}: MagicLinkFormProps) {
	const magicLinkSignIn = useMagicLinkSignIn();
	const [email, setEmail] = useState("");
	const [emailError, setEmailError] = useState<string | null>(null);

	const pending = isSubmitting || magicLinkSignIn.isPending;

	useEffect(() => {
		setIsSubmitting?.(magicLinkSignIn.isPending);
	}, [magicLinkSignIn.isPending, setIsSubmitting]);

	const submitMagicLink = async () => {
		const parseResult = magicLinkSchema.safeParse({
			email: email.trim().toLowerCase(),
		});
		if (!parseResult.success) {
			setEmailError(parseResult.error.flatten().fieldErrors.email?.[0] ?? null);
			return;
		}
		setEmailError(null);

		try {
			await magicLinkSignIn.mutateAsync({ email: parseResult.data.email });
			toast.success("Magic link sent to email");
			setEmail("");
		} catch (error) {
			toast.error(getAuthErrorMessage(error, "Failed to send magic link."));
		}
	};

	return (
		<ClientAuthForm
			className={`grid w-full gap-6 ${className ?? ""}`}
			onSubmit={(event) => {
				event.preventDefault();
				submitMagicLink().catch((error) => {
					toast.error(getAuthErrorMessage(error, "Failed to send magic link."));
				});
			}}
		>
			<div className="space-y-2">
				<Label>Email</Label>
				<Input
					aria-invalid={toAriaInvalid(emailError)}
					disabled={pending}
					onChange={(event) => {
						setEmail(event.target.value);
						if (emailError) {
							setEmailError(null);
						}
					}}
					placeholder="Email"
					type="email"
					value={email}
				/>
				{emailError ? (
					<p className="text-destructive text-xs">{emailError}</p>
				) : null}
			</div>

			<SpinnerButton
				buttonState={pending ? "loading" : "idle"}
				className="w-full text-md"
				disabled={pending}
				isLoading={pending}
				type="submit"
			>
				Send Magic Link
			</SpinnerButton>
		</ClientAuthForm>
	);
}
