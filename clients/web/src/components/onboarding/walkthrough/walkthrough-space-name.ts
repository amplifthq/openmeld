export function nextWelcomeSpaceName(names: readonly string[]): string {
	const occupied = new Set(names.map((name) => name.trim().toLowerCase()));
	let number = 1;
	let name = "Welcome to OpenMeld";
	while (occupied.has(name.toLowerCase())) {
		number += 1;
		name = `Welcome to OpenMeld (${number})`;
	}
	return name;
}
