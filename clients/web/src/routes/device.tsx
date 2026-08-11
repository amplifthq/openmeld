import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { CrossPageHeader } from "#/components/app/cross-page-header";
import {
	APP_PAGE_FRAME_CLASS_NAME,
	APP_PAGE_FRAME_PADDING_CLASS_NAME,
} from "#/components/app/shell-layout";
import { getSession } from "#/lib/auth-session";

const USER_CODE_REPLACE_PATTERN = /[^a-zA-Z0-9]/g;

function normalizeUserCode(value: string): string {
	return value.trim().replace(USER_CODE_REPLACE_PATTERN, "").toUpperCase();
}

export const Route = createFileRoute("/device")({
	beforeLoad: async ({ location }) => {
		const session = await getSession({
			data: {
				currentUserSessionExpectation: "required",
				routeFamily: location.pathname,
			},
		});
		if (!session) {
			throw redirect({
				to: "/login",
				search: {
					redirect: location.href,
				},
			});
		}

		if (location.pathname === "/device") {
			const queryParams = new URLSearchParams(location.search);
			const userCode = normalizeUserCode(queryParams.get("user_code") ?? "");
			throw redirect({
				replace: true,
				search: userCode ? { user_code: userCode } : {},
				to: "/device/approve",
			});
		}

		return { session };
	},
	component: DeviceLayoutRoute,
});

function DeviceLayoutRoute() {
	return (
		<main className="min-h-screen bg-background">
			<CrossPageHeader showNavigation={false} />
			<div
				className={`mx-auto flex min-h-[calc(100svh-65px)] w-full items-center justify-center py-6 ${APP_PAGE_FRAME_PADDING_CLASS_NAME} ${APP_PAGE_FRAME_CLASS_NAME}`}
			>
				<div className="w-full max-w-md md:w-md">
					<Outlet />
				</div>
			</div>
		</main>
	);
}
