import { Input } from "@openmeld/ui/components/input";
import { Label } from "@openmeld/ui/components/label";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod/v4";
import { ClientAuthForm } from "#/components/auth/forms/client-auth-form";
import { PasswordInput } from "#/components/auth/password-input";
import { SpinnerButton } from "#/components/spinner-button";
import { useEmailSignIn } from "#/hooks/auth-form.hooks";
import { useRedirectQueryPath } from "#/hooks/auth-redirect.hooks";
import { getAuthErrorCode, getAuthErrorMessage } from "#/lib/auth-errors";
import { withRedirectQuery } from "#/lib/auth-redirect";
import { toAriaInvalid } from "#/lib/form-error";

type SignInFormProps = {
	className?: string;
	isSubmitting?: boolean;
	setIsSubmitting?: (isSubmitting: boolean) => void;
};

const signInSchema = z.strictObject({
	email: z
		.string()
		.min(1, { message: "Email is required" })
		.email({ message: "Email is invalid" }),
	password: z.string().min(1, { message: "Password is required" }),
});

type SignInFieldErrors = {
	email?: string;
	password?: string;
};

export function SignInForm({
	className,
	isSubmitting = false,
	setIsSubmitting,
}: SignInFormProps) {
	const signIn = useEmailSignIn();
	const forgotPasswordPath = useRedirectQueryPath("/forgot-password");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [fieldErrors, setFieldErrors] = useState<SignInFieldErrors>({});

	const pending = isSubmitting || signIn.isPending;

	useEffect(() => {
		setIsSubmitting?.(signIn.isPending);
	}, [setIsSubmitting, signIn.isPending]);

	const submitSignIn = async () => {
		const parseResult = signInSchema.safeParse({
			email: email.trim().toLowerCase(),
			password,
		});
		if (!parseResult.success) {
			const errors = parseResult.error.flatten().fieldErrors;
			setFieldErrors({
				email: errors.email?.[0],
				password: errors.password?.[0],
			});
			return;
		}
		setFieldErrors({});

		try {
			const result = await signIn.mutateAsync({
				email: parseResult.data.email,
				password: parseResult.data.password,
			});
			setPassword("");
			window.location.assign(result.redirectTo);
		} catch (error) {
			setPassword("");
			if (getAuthErrorCode(error) === "EMAIL_NOT_VERIFIED") {
				window.location.assign(
					withRedirectQuery("/check-email", {
						email: parseResult.data.email,
					})
				);
				return;
			}
			toast.error(getAuthErrorMessage(error, "Failed to sign in."));
		}
	};

	return (
		<ClientAuthForm
			className={`grid w-full gap-6 ${className ?? ""}`}
			onSubmit={(event) => {
				event.preventDefault();
				submitSignIn().catch((error) => {
					setPassword("");
					toast.error(getAuthErrorMessage(error, "Failed to sign in."));
				});
			}}
		>
			<div className="space-y-2">
				<Label htmlFor="sign-in-email">Email</Label>
				<Input
					aria-invalid={toAriaInvalid(fieldErrors.email)}
					autoCapitalize="off"
					autoComplete="email"
					disabled={pending}
					id="sign-in-email"
					onChange={(event) => {
						setEmail(event.target.value);
						if (fieldErrors.email) {
							setFieldErrors((current) => ({ ...current, email: undefined }));
						}
					}}
					placeholder="your@email.com"
					spellCheck={false}
					type="email"
					value={email}
				/>
				{fieldErrors.email ? (
					<p className="text-destructive text-xs">{fieldErrors.email}</p>
				) : null}
			</div>

			<div className="space-y-2">
				<div className="flex items-center justify-between">
					<Label htmlFor="sign-in-password">Password</Label>
					<Link
						className="mr-0.5 inline-flex min-h-11 items-center px-0.5 text-muted-foreground text-sm outline-none hover:text-foreground hover:underline lg:min-h-0"
						to={forgotPasswordPath}
					>
						Forgot password?
					</Link>
				</div>
				<PasswordInput
					aria-invalid={toAriaInvalid(fieldErrors.password)}
					autoComplete="current-password"
					disabled={pending}
					id="sign-in-password"
					onChange={(event) => {
						setPassword(event.target.value);
						if (fieldErrors.password) {
							setFieldErrors((current) => ({
								...current,
								password: undefined,
							}));
						}
					}}
					value={password}
				/>
				{fieldErrors.password ? (
					<p className="text-destructive text-xs">{fieldErrors.password}</p>
				) : null}
			</div>

			<SpinnerButton
				buttonState={pending ? "loading" : "idle"}
				className="w-full text-md"
				disabled={pending}
				isLoading={pending}
				type="submit"
			>
				Sign in
			</SpinnerButton>
		</ClientAuthForm>
	);
}
