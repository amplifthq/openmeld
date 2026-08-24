import { Link } from "@tanstack/react-router";
import { BackButton } from "./back-button";

type AuthPageShellProps = {
	children: React.ReactNode;
};

export function AuthPageShell({ children }: AuthPageShellProps) {
	return (
		<main className="relative flex min-h-[100dvh] w-full flex-col items-center justify-center overflow-y-auto px-4 py-6 sm:px-6">
			<BackButton />
			{children}
			<nav
				aria-label="Legal"
				className="mt-4 flex items-center gap-3 text-muted-foreground/45 text-xs"
			>
				<Link
					className="inline-flex min-h-11 items-center transition-colors hover:text-muted-foreground lg:min-h-0"
					to="/privacy"
				>
					Privacy Policy
				</Link>
				<Link
					className="inline-flex min-h-11 items-center transition-colors hover:text-muted-foreground lg:min-h-0"
					to="/terms"
				>
					Terms of Service
				</Link>
			</nav>
		</main>
	);
}
