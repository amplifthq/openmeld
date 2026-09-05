export function getAppScrollRestorationKey(location: {
	pathname: string;
}): string {
	return location.pathname;
}
