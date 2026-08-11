import { Button } from "@openmeld/ui/components/button";
import { KeyIcon } from "@phosphor-icons/react";
import { usePasskeySignIn } from "#/hooks/auth.hooks";
import { openMeldAuthClient } from "#/lib/auth-client";
import { resolvePostAuthRedirect } from "#/lib/auth-redirect";
import { LastUsedBadge } from "./last-userd-badge";

type PasskeyButtonProps = {
	isSubmitting?: boolean;
	setIsSubmitting?: (isSubmitting: boolean) => void;
};

export function PasskeyButton({
	isSubmitting = false,
	setIsSubmitting,
}: PasskeyButtonProps) {
	const passkeySignIn = usePasskeySignIn();

	const onClick = async () => {
		if (passkeySignIn.isPending || isSubmitting) {
			return;
		}

		setIsSubmitting?.(true);

		try {
			const result = await passkeySignIn.mutateAsync();
			if (result.signedIn) {
				window.location.assign(resolvePostAuthRedirect());
				return;
			}

			setIsSubmitting?.(false);
		} catch {
			setIsSubmitting?.(false);
		}
	};

	const clientWithLastUsed = openMeldAuthClient as unknown as {
		getLastUsedLoginMethod?: () => string | undefined;
	};
	const isLastUsed =
		clientWithLastUsed.getLastUsedLoginMethod?.() === "passkey";

	return (
		<Button
			className="group relative w-full"
			disabled={isSubmitting || passkeySignIn.isPending}
			formNoValidate
			name="passkey"
			onClick={onClick}
			type="button"
			value="true"
			variant="authButton"
		>
			<div className="flex items-center gap-2">
				<KeyIcon className="size-4" />
				Continue with Passkey
			</div>
			{isLastUsed ? <LastUsedBadge /> : null}
		</Button>
	);
}
