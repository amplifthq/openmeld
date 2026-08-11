export function toAriaInvalid(
	hasError: string | boolean | null | undefined
): true | undefined {
	return hasError ? true : undefined;
}
