import { desktopLocalComputerSchema } from "@openmeld/schemas";
import { useQuery } from "@tanstack/react-query";
import { useAuthSession } from "#/hooks/auth.hooks";
import { getDesktopPlatform } from "./platform";

// Read the CLI-owned native projection; the account's current-Computer
// preference and a selected remote Computer never identify this Mac.
export function useDesktopComputerConnection() {
	const account = useAuthSession().data?.user.id;
	const desktop = getDesktopPlatform();
	return useQuery({
		queryKey: ["desktop", "computer-connection", account],
		enabled: Boolean(desktop && account),
		queryFn: async () =>
			desktopLocalComputerSchema.parse(await desktop?.localComputer()),
		staleTime: 0,
		retry: false,
	});
}
