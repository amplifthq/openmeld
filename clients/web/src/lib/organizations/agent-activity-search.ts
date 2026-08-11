import { createParser, createStandardSchemaV1 } from "nuqs";

const PROJECT_ID_MAX_LENGTH = 256;

export const agentActivityProjectScopeParser = createParser({
	parse: (value) => {
		const projectId = value.trim();
		return projectId.length > 0 && projectId.length <= PROJECT_ID_MAX_LENGTH
			? projectId
			: null;
	},
	serialize: (value: string) => value,
}).withOptions({ history: "replace" });

export const agentActivitySearchParams = {
	project: agentActivityProjectScopeParser,
};

export const agentActivitySearchSchema = createStandardSchemaV1(
	agentActivitySearchParams,
	{ partialOutput: true }
);
