import { Button } from "@openmeld/ui/components/button";
import { useSocialSignIn } from "#/hooks/auth.hooks";
import { openMeldAuthClient } from "#/lib/auth-client";
import { LastUsedBadge } from "./last-userd-badge";
import type { SocialProvider } from "./social-providers";

type ProviderButtonProps = {
	provider: SocialProvider;
	isSubmitting?: boolean;
	setIsSubmitting?: (isSubmitting: boolean) => void;
};

export function ProviderButton({
	provider,
	isSubmitting = false,
	setIsSubmitting,
}: ProviderButtonProps) {
	const socialSignIn = useSocialSignIn();

	const onClick = async () => {
		if (socialSignIn.isPending || isSubmitting) {
			return;
		}

		setIsSubmitting?.(true);

		try {
			await socialSignIn.mutateAsync(provider.providerId);
		} catch {
			setIsSubmitting?.(false);
		}
	};

	const clientWithLastUsed = openMeldAuthClient as unknown as {
		getLastUsedLoginMethod?: () => string | undefined;
	};
	const isLastUsed =
		clientWithLastUsed.getLastUsedLoginMethod?.() === provider.providerId;
	const Icon = provider.icon;

	return (
		<Button
			className="group relative w-full"
			disabled={isSubmitting || socialSignIn.isPending}
			onClick={onClick}
			type="button"
			variant="authButton"
		>
			<div className="flex items-center gap-2">
				<Icon className="size-4" />
				Continue with {provider.name}
			</div>
			{isLastUsed ? <LastUsedBadge /> : null}
		</Button>
	);
}
