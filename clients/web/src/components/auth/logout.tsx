import { Bars } from "@openmeld/ui/components/bars";
import { Button } from "@openmeld/ui/components/button";
import { XCircleIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { useLogoutAction } from "#/hooks/auth-form.hooks";
import { getAuthErrorMessage } from "#/lib/auth-errors";

export function Logout() {
	const logoutAction = useLogoutAction();
	const startedRef = useRef(false);
	const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const [state, dispatch] = useReducer(logoutReducer, {
		message: "",
		status: "logging-out",
	});

	const clearRedirectTimer = useCallback(() => {
		if (redirectTimerRef.current === null) {
			return;
		}
		clearTimeout(redirectTimerRef.current);
		redirectTimerRef.current = null;
	}, []);

	const scheduleEntryRedirect = useCallback(() => {
		clearRedirectTimer();
		redirectTimerRef.current = setTimeout(() => {
			window.location.assign("/");
		}, 300);
	}, [clearRedirectTimer]);

	useEffect(() => {
		if (startedRef.current) {
			return;
		}
		startedRef.current = true;

		logoutAction
			.mutateAsync()
			.then(() => {
				dispatch({ type: "redirecting" });
				scheduleEntryRedirect();
			})
			.catch((error) => {
				dispatch({
					message: getAuthErrorMessage(error, "Failed to sign out."),
					type: "error",
				});
			});

		return clearRedirectTimer;
	}, [clearRedirectTimer, logoutAction, scheduleEntryRedirect]);

	const onRetry = async () => {
		dispatch({ type: "logging-out" });
		try {
			await logoutAction.mutateAsync();
			dispatch({ type: "redirecting" });
			scheduleEntryRedirect();
		} catch (error) {
			dispatch({
				message: getAuthErrorMessage(error, "Failed to sign out."),
				type: "error",
			});
		}
	};

	if (state.status === "error") {
		return (
			<div className="flex min-h-[200px] items-center justify-center">
				<div className="flex flex-col items-center gap-3 text-center">
					<XCircleIcon className="size-8 text-destructive" />
					<p className="text-muted-foreground text-sm">{state.message}</p>
					<div className="flex flex-wrap items-center justify-center gap-2">
						<Button onClick={onRetry} type="button" variant="outline">
							Retry
						</Button>
						<Link
							className="text-muted-foreground text-sm underline"
							to="/login"
						>
							Back to sign in
						</Link>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="flex min-h-[200px] items-center justify-center">
			<div className="flex flex-col items-center gap-4">
				<Bars className="h-8 w-12" />
				<p className="text-muted-foreground text-sm">
					{state.status === "redirecting" ? "Goodbye" : "Logging out"}
				</p>
			</div>
		</div>
	);
}

type LogoutState = {
	status: "logging-out" | "redirecting" | "error";
	message: string;
};

type LogoutAction =
	| { type: "logging-out" }
	| { type: "redirecting" }
	| { type: "error"; message: string };

function logoutReducer(_state: LogoutState, action: LogoutAction): LogoutState {
	switch (action.type) {
		case "logging-out":
			return { message: "", status: "logging-out" };
		case "redirecting":
			return { message: "", status: "redirecting" };
		case "error":
			return { message: action.message, status: "error" };
		default:
			return _state;
	}
}
