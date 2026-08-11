import { Bars } from "@openmeld/ui/components/bars";
import { XCircleIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAuthSession } from "#/hooks/auth.hooks";
import { resolvePostAuthRedirect } from "#/lib/auth-redirect";

function readCallbackError(): string | null {
	if (typeof window === "undefined") {
		return null;
	}

	const error = new URLSearchParams(window.location.search).get("error");
	if (!error) {
		return null;
	}

	return `Callback returned error: ${error}`;
}

export function AuthCallback() {
	const { refetch } = useAuthSession();
	const callbackError = useMemo(() => readCallbackError(), []);
	const redirectTarget = useMemo(() => resolvePostAuthRedirect(), []);
	const [status, setStatus] = useState<"loading" | "redirecting" | "error">(
		"loading"
	);
	const [message, setMessage] = useState<string>("");

	useEffect(() => {
		if (callbackError) {
			setStatus("error");
			setMessage(callbackError);
			return;
		}

		let active = true;
		const completeAuth = async () => {
			setStatus("loading");
			setMessage("");

			try {
				const result = await refetch();
				if (!active) {
					return;
				}

				if (!result.data?.user) {
					setStatus("error");
					setMessage("No active session after callback.");
					return;
				}

				setStatus("redirecting");
				window.location.assign(redirectTarget);
			} catch {
				if (!active) {
					return;
				}
				setStatus("error");
				setMessage("Unable to complete authentication callback.");
			}
		};

		completeAuth().catch(() => {
			if (!active) {
				return;
			}
			setStatus("error");
			setMessage("Unable to complete authentication callback.");
		});

		return () => {
			active = false;
		};
	}, [callbackError, redirectTarget, refetch]);

	if (status === "error") {
		return (
			<div className="flex min-h-[200px] items-center justify-center">
				<div className="flex flex-col items-center gap-3 text-center">
					<XCircleIcon className="size-8 text-destructive" />
					<p className="text-muted-foreground text-sm">{message}</p>
					<Link className="text-muted-foreground text-sm underline" to="/login">
						Back to sign in
					</Link>
				</div>
			</div>
		);
	}

	return (
		<div className="flex min-h-[200px] items-center justify-center">
			<div className="flex flex-col items-center gap-4">
				<Bars className="h-8 w-12" />
				<p className="text-muted-foreground text-sm">
					{status === "loading"
						? "Completing authentication..."
						: "Redirecting..."}
				</p>
			</div>
		</div>
	);
}
