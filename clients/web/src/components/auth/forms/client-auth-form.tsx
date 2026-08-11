import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { useEffect, useState } from "react";

type ClientAuthFormProps = ComponentPropsWithoutRef<"form"> & {
	children: ReactNode;
};

export function ClientAuthForm({
	children,
	onSubmit,
	...props
}: ClientAuthFormProps) {
	const hydrated = useClientHydrationReady();

	return (
		<form
			{...props}
			onSubmit={(event) => {
				if (!hydrated) {
					event.preventDefault();
					return;
				}
				onSubmit?.(event);
			}}
		>
			<fieldset className="contents" disabled={!hydrated}>
				{children}
			</fieldset>
		</form>
	);
}

function useClientHydrationReady(): boolean {
	const [hydrated, setHydrated] = useState(false);

	useEffect(() => {
		setHydrated(true);
	}, []);

	return hydrated;
}
