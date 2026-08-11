import { Bars } from "@openmeld/ui/components/bars";
import { Link } from "@tanstack/react-router";
import { openMeldAuthClient } from "#/lib/auth-client";

export default function BetterAuthHeader() {
	const { data: session, isPending } = openMeldAuthClient.useSession();

	if (isPending) {
		return (
			<div className="flex size-8 items-center justify-center bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
				<Bars className="h-3 w-5" />
			</div>
		);
	}

	if (session?.user) {
		return (
			<div className="flex items-center gap-2">
				{session.user.image ? (
					<img
						alt=""
						className="size-8"
						height={32}
						src={session.user.image}
						width={32}
					/>
				) : (
					<div className="flex size-8 items-center justify-center bg-neutral-100 dark:bg-neutral-800">
						<span className="font-medium text-neutral-600 text-xs dark:text-neutral-400">
							{session.user.name?.charAt(0).toUpperCase() || "U"}
						</span>
					</div>
				)}
				<button
					className="h-9 flex-1 border border-neutral-300 bg-white px-4 font-medium text-neutral-900 text-sm transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
					onClick={async () => {
						await openMeldAuthClient.signOut();
					}}
					type="button"
				>
					Sign out
				</button>
			</div>
		);
	}

	return (
		<Link
			className="inline-flex h-9 items-center border border-neutral-300 bg-white px-4 font-medium text-neutral-900 text-sm transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
			to="/"
		>
			Sign in
		</Link>
	);
}
