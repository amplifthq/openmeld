import { AuthCallback } from "#/components/auth/auth-callback";
import type { AuthView } from "#/components/auth/auth-views";
import { ForgotPasswordForm } from "#/components/auth/forms/forgot-password-form";
import { MagicLinkForm } from "#/components/auth/forms/magic-link-form";
import { ResetPasswordForm } from "#/components/auth/forms/reset-password-form";
import { SignInForm } from "#/components/auth/forms/sign-in-form";
import { SignUpForm } from "#/components/auth/forms/sign-up-form";
import { UnifiedVerificationForm } from "#/components/auth/forms/unified-verification-form";
import { Logout } from "#/components/auth/logout";

type AuthFormProps = {
	className?: string;
	isSubmitting?: boolean;
	setIsSubmitting?: (isSubmitting: boolean) => void;
	view: AuthView;
	hasToken?: boolean;
};

export function AuthForm({
	className,
	isSubmitting,
	setIsSubmitting,
	view,
	hasToken = false,
}: AuthFormProps) {
	switch (view) {
		case "login":
			return (
				<SignInForm
					className={className}
					isSubmitting={isSubmitting}
					setIsSubmitting={setIsSubmitting}
				/>
			);
		case "signUp":
			return (
				<SignUpForm
					className={className}
					isSubmitting={isSubmitting}
					setIsSubmitting={setIsSubmitting}
				/>
			);
		case "magicLink":
			return hasToken ? (
				<UnifiedVerificationForm verificationKind="magic-link" />
			) : (
				<MagicLinkForm
					className={className}
					isSubmitting={isSubmitting}
					setIsSubmitting={setIsSubmitting}
				/>
			);
		case "forgotPassword":
			return (
				<ForgotPasswordForm
					className={className}
					isSubmitting={isSubmitting}
					setIsSubmitting={setIsSubmitting}
				/>
			);
		case "resetPassword":
			return <ResetPasswordForm className={className} />;
		case "verifyEmail":
			return <UnifiedVerificationForm verificationKind="email" />;
		case "callback":
			return <AuthCallback />;
		case "logout":
			return <Logout />;
		default:
			return null;
	}
}
