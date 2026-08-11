import { siteConfig } from "#/lib/site";

export const authViewSegments = {
	login: "login",
	signUp: "sign-up",
	magicLink: "magic-link",
	forgotPassword: "forgot-password",
	resetPassword: "reset-password",
	verifyEmail: "verify-email",
	callback: "callback",
	logout: "logout",
} as const;

export type AuthView = keyof typeof authViewSegments;

export type AuthViewMeta = {
	title: string;
	description: string;
};

const authViewMetaMap: Record<AuthView, AuthViewMeta> = {
	login: {
		title: "Login to OpenMeld",
		description: "Please sign in to your account to continue.",
	},
	signUp: {
		title: `Sign Up to ${siteConfig.name}`,
		description: `Create a new account to get started with ${siteConfig.name}.`,
	},
	magicLink: {
		title: `Magic Link to ${siteConfig.name}`,
		description: "We'll send you a secure link to sign in without a password.",
	},
	forgotPassword: {
		title: `Forgot Password for ${siteConfig.name}`,
		description: "Enter your email address and we'll send you a reset link.",
	},
	resetPassword: {
		title: `Reset Password for ${siteConfig.name}`,
		description: "Create a new password for your account.",
	},
	verifyEmail: {
		title: "Verify Your Email",
		description:
			"Click the verification link in your email to complete account setup.",
	},
	callback: {
		title: "Auth callback",
		description: "Finishing provider sign-in.",
	},
	logout: {
		title: "Logout",
		description: "Sign out from the current session.",
	},
};

export const AUTH_VIEWS_WITH_SOCIAL_SECTION: readonly AuthView[] = [
	"login",
	"signUp",
	"magicLink",
];

export function getAuthViewMeta(view: AuthView): AuthViewMeta {
	return authViewMetaMap[view];
}
