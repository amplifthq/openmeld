import { Button } from "@openmeld/ui/components/button";
import { DirectoryHumanProfileDetails } from "../../src/components/directory/directory-human-profile-details";
import type { DirectoryHumanProfileRow } from "../../src/components/directory/directory-human-profile-model";
import { TeamHome } from "../../src/components/directory/team-home";

export function DemoPeople({
	people,
	selectedPerson,
	onSelectPerson,
}: {
	people: DirectoryHumanProfileRow[];
	selectedPerson: string | null;
	onSelectPerson: (id: string | null) => void;
}) {
	const member = people.find((p) => p.id === selectedPerson);
	if (!member) {
		return (
			<TeamHome
				activityNowMs={1_791_334_800_000}
				computerGroups={[]}
				members={people}
				onSelect={onSelectPerson}
			/>
		);
	}
	return (
		<>
			<Button onClick={() => onSelectPerson(null)} size="sm" variant="ghost">
				All people
			</Button>
			<DirectoryHumanProfileDetails
				activityNowMs={1_791_334_800_000}
				conversationsEnabled={false}
				directMessageEnabled={false}
				directMessageIsPending={false}
				editing={false}
				member={member}
				modelCatalog={null}
				onConnectAccount={() => undefined}
				onEditingChange={() => undefined}
				onManageAccount={() => undefined}
				onOpenDirectMessage={() => undefined}
				onRetryProfileReports={() => undefined}
				profileReportsAreRetrying={false}
				profileReportsErrorMessage={null}
				researchAction={null}
			/>
		</>
	);
}
