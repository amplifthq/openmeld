import { Input } from "@openmeld/ui/components/input";
import { Label } from "@openmeld/ui/components/label";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod/v4";
import { ClientAuthForm } from "#/components/auth/forms/client-auth-form";
import { PasswordInput } from "#/components/auth/password-input";
import { SpinnerButton } from "#/components/spinner-button";
import { useEmailSignUp } from "#/hooks/auth-form.hooks";
import { getAuthErrorMessage } from "#/lib/auth-errors";
import { withRedirectQuery } from "#/lib/auth-redirect";
import { toAriaInvalid } from "#/lib/form-error";

type SignUpFormProps = {
	className?: string;
	isSubmitting?: boolean;
	setIsSubmitting?: (isSubmitting: boolean) => void;
};

const signUpSchema = z
	.strictObject({
		name: z.string().min(1, { message: "Name is required" }),
		email: z
			.string()
			.min(1, { message: "Email is required" })
			.email({ message: "Email is invalid" }),
		password: z.string().min(8, { message: "Password is too short" }),
		confirmPassword: z
			.string()
			.min(1, { message: "Confirm Password is required" }),
	})
	.refine((data) => data.password === data.confirmPassword, {
		message: "Passwords do not match",
		path: ["confirmPassword"],
	});

type SignUpFieldErrors = {
	name?: string;
	email?: string;
	password?: string;
	confirmPassword?: string;
};

export function SignUpForm({
	className,
	isSubmitting = false,
	setIsSubmitting,
}: SignUpFormProps) {
	const signUp = useEmailSignUp();
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [fieldErrors, setFieldErrors] = useState<SignUpFieldErrors>({});

	const pending = isSubmitting || signUp.isPending;

	useEffect(() => {
		setIsSubmitting?.(signUp.isPending);
	}, [setIsSubmitting, signUp.isPending]);

	const submitSignUp = async () => {
		const parseResult = signUpSchema.safeParse({
			name: name.trim(),
			email: email.trim().toLowerCase(),
			password,
			confirmPassword,
		});
		if (!parseResult.success) {
			const errors = parseResult.error.flatten().fieldErrors;
			setFieldErrors({
				name: errors.name?.[0],
				email: errors.email?.[0],
				password: errors.password?.[0],
				confirmPassword: errors.confirmPassword?.[0],
			});
			return;
		}
		setFieldErrors({});

		try {
			await signUp.mutateAsync({
				email: parseResult.data.email,
				password: parseResult.data.password,
				name: parseResult.data.name,
			});
			setPassword("");
			setConfirmPassword("");
			window.location.assign(
				withRedirectQuery("/check-email", {
					email: parseResult.data.email,
				})
			);
		} catch (error) {
			setPassword("");
			setConfirmPassword("");
			toast.error(getAuthErrorMessage(error, "Failed to create account."));
		}
	};

	return (
		<ClientAuthForm
			className={`grid w-full gap-6 ${className ?? ""}`}
			onSubmit={(event) => {
				event.preventDefault();
				submitSignUp().catch((error) => {
					setPassword("");
					setConfirmPassword("");
					toast.error(getAuthErrorMessage(error, "Failed to create account."));
				});
			}}
		>
			<div className="space-y-2">
				<Label>Name</Label>
				<Input
					aria-invalid={toAriaInvalid(fieldErrors.name)}
					disabled={pending}
					onChange={(event) => {
						setName(event.target.value);
						if (fieldErrors.name) {
							setFieldErrors((current) => ({ ...current, name: undefined }));
						}
					}}
					placeholder="Name"
					value={name}
				/>
				{fieldErrors.name ? (
					<p className="text-destructive text-xs">{fieldErrors.name}</p>
				) : null}
			</div>

			<div className="space-y-2">
				<Label>Email</Label>
				<Input
					aria-invalid={toAriaInvalid(fieldErrors.email)}
					disabled={pending}
					onChange={(event) => {
						setEmail(event.target.value);
						if (fieldErrors.email) {
							setFieldErrors((current) => ({ ...current, email: undefined }));
						}
					}}
					placeholder="your@email.com"
					type="email"
					value={email}
				/>
				{fieldErrors.email ? (
					<p className="text-destructive text-xs">{fieldErrors.email}</p>
				) : null}
			</div>

			<div className="space-y-2">
				<Label>Password</Label>
				<PasswordInput
					aria-invalid={toAriaInvalid(fieldErrors.password)}
					autoComplete="new-password"
					disabled={pending}
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

			<div className="space-y-2">
				<Label>Confirm Password</Label>
				<PasswordInput
					aria-invalid={toAriaInvalid(fieldErrors.confirmPassword)}
					autoComplete="new-password"
					disabled={pending}
					onChange={(event) => {
						setConfirmPassword(event.target.value);
						if (fieldErrors.confirmPassword) {
							setFieldErrors((current) => ({
								...current,
								confirmPassword: undefined,
							}));
						}
					}}
					value={confirmPassword}
				/>
				{fieldErrors.confirmPassword ? (
					<p className="text-destructive text-xs">
						{fieldErrors.confirmPassword}
					</p>
				) : null}
			</div>

			<SpinnerButton
				buttonState={pending ? "loading" : "idle"}
				className="w-full text-md"
				disabled={pending}
				isLoading={pending}
				type="submit"
			>
				Sign up
			</SpinnerButton>
		</ClientAuthForm>
	);
}
