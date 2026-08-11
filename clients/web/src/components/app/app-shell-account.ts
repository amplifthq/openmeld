import { createContext, use } from "react";

export type AppShellAccount = {
	email?: string | null;
	image?: string | null;
	name?: string | null;
};

export const AppShellAccountContext = createContext<AppShellAccount | null>(
	null
);

export function useAppShellAccount(): AppShellAccount {
	const account = use(AppShellAccountContext);
	if (!account) {
		throw new Error("App shell account is unavailable outside the app shell.");
	}

	return account;
}
