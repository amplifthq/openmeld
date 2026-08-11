import { Bars } from "@openmeld/ui/components/bars";
import { buttonVariants } from "@openmeld/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@openmeld/ui/components/card";
import { OPENMELD_LOGO_THEME_COLORS } from "@openmeld/ui/lib/openmeld-logo-theme";
import { cn } from "@openmeld/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { OpenMeldLogo } from "#/components/openmeld-logo-weak";
import { useResendVerificationEmail } from "#/hooks/auth-form.hooks";
import { useRedirectQueryPath } from "#/hooks/auth-redirect.hooks";
import { getAuthErrorMessage } from "#/lib/auth-errors";

type CheckEmailCardProps = {
	email: string | null;
};

const AUTH_CARD_LOGO_SCALE = 0.2;

export function CheckEmailCard({ email }: CheckEmailCardProps) {
	const resendVerificationEmail = useResendVerificationEmail();
	const loginPath = useRedirectQueryPath("/login");
	const normalizedEmail = normalizeOptionalEmail(email);
	const canResend = normalizedEmail !== null;

	return (
		<div className="w-full max-w-md md:w-md">
			<div className="flex flex-col items-center gap-y-2">
				<div className="w-fit">
					<OpenMeldLogo
						colors={OPENMELD_LOGO_THEME_COLORS}
						scale={AUTH_CARD_LOGO_SCALE}
					/>
				</div>
				<span className="font-semibold text-3xl">Check your email</span>
				<span className="my-2 max-w-sm text-pretty text-center font-medium text-muted-foreground">
					{normalizedEmail
						? "Open the verification email we sent and click the link to continue."
						: "Open your verification email and click the link to continue."}
				</span>
			</div>

			<Card className="w-full border-none">
				<CardHeader className="gap-3">
					<CardTitle className="font-medium text-lg">
						Email verification
					</CardTitle>
					<CardDescription className="text-sm leading-6">
						{normalizedEmail
							? "We sent a verification link to this address."
							: "If you need another verification link, go back to sign in and try again."}
					</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-4">
					{normalizedEmail ? (
						<div className="border border-border/70 bg-muted/20 px-3 py-2 font-medium text-sm">
							{normalizedEmail}
						</div>
					) : null}

					<div className="grid gap-2">
						{canResend ? (
							<button
								className={cn(
									buttonVariants({ size: "sm", variant: "default" }),
									"w-full"
								)}
								disabled={resendVerificationEmail.isPending}
								onClick={async () => {
									if (!normalizedEmail) {
										return;
									}

									try {
										await resendVerificationEmail.mutateAsync({
											email: normalizedEmail,
										});
										toast.success("Verification email sent.");
									} catch (error) {
										toast.error(
											getAuthErrorMessage(
												error,
												"Couldn't resend the verification email."
											)
										);
									}
								}}
								type="button"
							>
								{resendVerificationEmail.isPending ? (
									<>
										<Bars className="h-4 w-5" />
										Sending…
									</>
								) : (
									"Resend verification email"
								)}
							</button>
						) : null}

						<Link
							className={cn(
								buttonVariants({ size: "sm", variant: "outline" }),
								"w-full"
							)}
							to={loginPath}
						>
							Back to sign in
						</Link>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}

function normalizeOptionalEmail(value: string | null): string | null {
	if (typeof value !== "string") {
		return null;
	}

	const normalized = value.trim().toLowerCase();
	return normalized.length > 0 ? normalized : null;
}
