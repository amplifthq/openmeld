export function isOrganizationWakeAccessReasonCode(
	reasonCode: string | null | undefined
): boolean {
	return (
		reasonCode === "binding_required" ||
		reasonCode?.startsWith("organization.") === true ||
		reasonCode?.startsWith("organization_binding_authorization.") === true
	);
}
