import { Button } from "@openmeld/ui/components/button";
import { LockKeyIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { openDesktopWeb } from "#/desktop/platform";

export function DesktopProtectedSpaceHandoff({ spaceId }: { spaceId: string }) {
	const [error, setError] = useState<string | null>(null);
	return (
		<section className="flex h-full min-h-64 w-full flex-col items-center justify-center gap-3 px-6 text-center">
			<LockKeyIcon
				aria-hidden="true"
				className="size-6 text-muted-foreground"
			/>
			<h1 className="font-medium text-lg">This Space requires a password</h1>
			<p className="max-w-sm text-muted-foreground text-sm">
				Enter the password in OpenMeld Web to open this Space.
			</p>
			<Button
				onClick={() => {
					setError(null);
					openDesktopWeb(`/spaces/${encodeURIComponent(spaceId)}`).catch(
						(failure: unknown) =>
							setError(
								failure instanceof Error
									? failure.message
									: "Could not open OpenMeld Web. Try again."
							)
					);
				}}
				type="button"
			>
				Open in OpenMeld Web
			</Button>
			{error ? (
				<p className="text-destructive text-sm" role="alert">
					{error}
				</p>
			) : null}
		</section>
	);
}
