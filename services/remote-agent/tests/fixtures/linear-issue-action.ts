// Target fields and required keys from OpenConnector's Linear create action.
// https://github.com/oomol-lab/open-connector/blob/main/src/providers/linear/actions.ts
export const linearIssueCreateInputSchema = {
  type: "object",
  properties: {
    title: { type: "string", minLength: 1 },
    team_id: { type: "string", minLength: 1 },
    project_id: { type: "string", minLength: 1 },
    description: { type: "string" },
  },
  required: ["title", "team_id"],
};
