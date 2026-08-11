export type ResponseBodyReadResult =
	| {
			ok: true;
			value: unknown;
			empty: boolean;
	  }
	| {
			ok: false;
			reason: "invalid_json" | "read_error";
	  };

export async function readResponseBody(
	response: Response
): Promise<ResponseBodyReadResult> {
	const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
	const textResult = await readResponseText(response);
	if (!textResult.ok) {
		return textResult;
	}

	const rawText = textResult.value;
	if (contentType.includes("application/json")) {
		if (rawText.trim().length === 0) {
			return {
				ok: true,
				value: null,
				empty: true,
			};
		}

		try {
			return {
				ok: true,
				value: JSON.parse(rawText),
				empty: false,
			};
		} catch {
			return {
				ok: false,
				reason: "invalid_json",
			};
		}
	}

	if (rawText.length === 0) {
		return {
			ok: true,
			value: null,
			empty: true,
		};
	}

	return {
		ok: true,
		value: { message: rawText },
		empty: false,
	};
}

async function readResponseText(
	response: Response
): Promise<{ ok: true; value: string } | { ok: false; reason: "read_error" }> {
	try {
		return {
			ok: true,
			value: await response.text(),
		};
	} catch {
		return {
			ok: false,
			reason: "read_error",
		};
	}
}
