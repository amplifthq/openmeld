/** Sanitized causal replays for #340, not verbatim transcripts or production traces. */
export type MemoryBaselineCase = {
  id: string;
  origin: "historical_replay" | "derived_control";
  description: string;
  turns: { user: string; assistant: string }[];
  explicitSave?: string;
  query: string;
  focusedQuery: string;
  question: string;
  currentEvidence: string;
  verifiedContext: string;
  expected: Record<string, string | boolean | null>;
};

export const memoryBaselineCases: MemoryBaselineCase[] = [
  {
    id: "confirmed-identity",
    origin: "historical_replay",
    description:
      "A shared conversation confirms a cross-provider identity; a later turn asks again. Related public report: #294.",
    turns: [
      {
        user: "Yes. The Linear account cedar312 belongs to Nora. This confirms the identity mapping for the Cedar organization.",
        assistant: "Understood. cedar312 is Nora's Linear account.",
      },
    ],
    query: "Nora 的 Linear 账号确认过了吗？",
    focusedQuery: "Cedar organization Nora confirmed Linear account handle",
    question:
      "Has Nora's Linear account been confirmed? Return JSON with linearHandle (string or null) and requiresIdentityConfirmation (boolean).",
    currentEvidence:
      "The requester is asking about the previously confirmed mapping, not asking to assign an issue. There is no new conflicting identity evidence.",
    verifiedContext:
      "A member explicitly confirmed that cedar312 is Nora's Linear account in the Cedar organization. Center Agent acknowledged the confirmation.",
    expected: { linearHandle: "cedar312", requiresIdentityConfirmation: false },
  },
  {
    id: "stale-explicit-save",
    origin: "historical_replay",
    description:
      "A rule is corrected in shared chat, but a later explicit save summarizes an older unresolved version. Related public report: #307.",
    turns: [
      {
        user: "In Cedar Issues, Phase 1 is triage only. The decision on whether agents may build is still pending.",
        assistant: "I will keep the build decision pending.",
      },
      {
        user: "Update: build only when someone explicitly asks. Create the Linear issue first, then hand the work to a developer Agent. PRs need human review.",
        assistant: "I will use that exception for explicit build requests.",
      },
      {
        user: "Replace that handoff step: when explicitly asked to build, create the Linear issue, assign it to yourself and build it yourself. PRs still need human review; never merge your own PR.",
        assistant:
          "The builder is now Center Agent itself. The build decision is resolved for explicit build requests.",
      },
    ],
    explicitSave:
      "Cedar Issues rules: create Linear issues. Phase 1 is triage only; the owner's decision on build permission is still pending.",
    query: "Cedar Issues 的 build 规则是什么？",
    focusedQuery:
      "Cedar Issues latest corrected rule explicit build request builder human PR review",
    question:
      "Summarize the most recently confirmed Cedar Issues rule for explicit build requests. Return JSON with builder (center_agent, developer_agent, or unknown), needsBuildDecision (boolean), createIssueFirst (boolean), and humanReview (boolean). This is a question about the recorded rule, not authorization to execute it.",
    currentEvidence:
      "No tools or write actions are available in this evaluation.",
    verifiedContext:
      "The last confirmed correction for Cedar Issues says: for an explicit build request, first create the Linear issue, assign it to Center Agent, and have Center Agent build it itself. The build decision is resolved. A human must review the PR; the Agent cannot merge its own PR. The later saved summary saying the build decision is pending was stale.",
    expected: {
      builder: "center_agent",
      needsBuildDecision: false,
      createIssueFirst: true,
      humanReview: true,
    },
  },
  {
    id: "terse-project-continuation",
    origin: "historical_replay",
    description:
      "A repository correction precedes a short continuation. Goal ownership remains separate from semantic memory.",
    turns: [
      {
        user: "Review the issue in cedar/console.",
        assistant: "I will inspect cedar/console.",
      },
      {
        user: "Correction: this work is in cedar/mail, not cedar/console.",
        assistant: "The current task's repository is cedar/mail.",
      },
    ],
    query: "继续",
    focusedQuery: "current review task corrected repository cedar mail console",
    question:
      "Which repository does this continuation refer to? Return JSON with repository (string or null). Do not choose a repository without evidence.",
    currentEvidence:
      "This is a recall probe with the canonical work-target record deliberately absent. It does not test or replace the existing work-target owner.",
    verifiedContext:
      "The user corrected the current review task from cedar/console to cedar/mail; the Agent acknowledged it. The continuation belongs to that same task.",
    expected: { repository: "cedar/mail" },
  },
  {
    id: "current-task-over-history",
    origin: "derived_control",
    description:
      "Historical failure must not override a current authoritative Task read.",
    turns: [],
    explicitSave:
      "The Cedar review Task failed yesterday and was not accepted then.",
    query: "Cedar review Task 现在完成了吗？",
    focusedQuery: "Cedar review Task historical failure acceptance",
    question:
      "Return the current Task state as JSON with phase (string) and accepted (boolean).",
    currentEvidence:
      'Current authoritative Task tool result: {"phase":"done","revision":5,"resultRevision":4,"review":{"status":"accepted"}}.',
    verifiedContext:
      "The failure was historical. The current Task read reports done with an accepted review.",
    expected: { phase: "done", accepted: true },
  },
  {
    id: "bounded-search-not-absence",
    origin: "historical_replay",
    description:
      "A bounded thread search was interpreted as evidence that no rule exists.",
    turns: [],
    query: "这里没有规则吗？",
    focusedQuery: "Cedar Issues Space rules original source",
    question:
      "Does the available search evidence establish that the Space has no rules? Return JSON with rulesProvenAbsent (boolean) and nextStep (search_broader_sources or conclude_absent).",
    currentEvidence:
      'Current history tool result: {"scope":"current_thread","matchingRules":[],"completeHistory":false,"hasMore":true}. No full-Space search has been performed.',
    verifiedContext:
      "Only a bounded current-thread search returned no matching rule. Broader authorized history and current Guide remain unchecked; absence is not established.",
    expected: { rulesProvenAbsent: false, nextStep: "search_broader_sources" },
  },
  {
    id: "bound-goal-over-unrelated-memory",
    origin: "derived_control",
    description:
      "A remembered repository from unrelated work must not replace the current canonical work target.",
    turns: [],
    explicitSave:
      "An unrelated completed review used the cedar/console repository.",
    query: "继续当前的 review",
    focusedQuery: "Cedar review repository",
    question:
      "Which repository belongs to the current work target? Return JSON with repository (string or null).",
    currentEvidence:
      'Current authoritative work-target read: {"requestGoal":"Review the mail change","codeRepositories":[{"owner":"cedar","repo":"mail"}],"revision":2}. This continuation is bound to that work target.',
    verifiedContext:
      "The current authoritative work target selects cedar/mail. A historical review in cedar/console was separate work.",
    expected: { repository: "cedar/mail" },
  },
];
