// Render factual comparisons only. Product recommendations belong to the reviewer.
const PARAGRAPH_BREAK = /\n\s*\n/;
const CONSTRAINT =
  /retire|no longer available|requires .*version|requires .*v\d|only available|rollout/i;
const NON_ALPHANUMERIC = /[^a-z0-9]/g;
const cell = (value) =>
  String(value ?? "unknown")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

export function discoveryCandidates(evidence, current, discoverySince) {
  const existingIds = current.agentControllers[evidence.controller].models.map(
    (model) => model.id
  );
  const existing = new Set(existingIds);
  const existingCursorIdsByBase = new Map();
  if (evidence.controller === "cursor") {
    for (const id of existingIds) {
      const baseId = id.split("[", 1)[0];
      const matchingIds = existingCursorIdsByBase.get(baseId) ?? [];
      matchingIds.push(id);
      existingCursorIdsByBase.set(baseId, matchingIds);
    }
  }
  return evidence.sources
    .filter((source) => source.kind === "discovery-only")
    .flatMap((source) =>
      Object.entries(source.data).flatMap(([provider, models]) =>
        Object.values(models)
          .filter(
            (model) =>
              !(discoverySince && model.release_date) ||
              model.release_date >= discoverySince
          )
          .map((model) => {
            const candidateId =
              ["opencode", "opencode-go"].includes(provider) ||
              evidence.controller === "opencode"
                ? `${provider}/${model.id}`
                : model.id;
            return {
              matchingExistingIds:
                evidence.controller === "cursor"
                  ? (existingCursorIdsByBase.get(model.id) ?? [])
                  : [],
              candidateId,
              model,
              provider,
              url: source.url,
            };
          })
          .filter(
            ({ candidateId, matchingExistingIds }) =>
              matchingExistingIds.length > 0 || !existing.has(candidateId)
          )
      )
    );
}

function sourceComparison(evidence) {
  const rows = [];
  for (const change of evidence.changes) {
    for (const source of evidence.sources.filter(
      (item) => item.kind === "discovery-only"
    )) {
      for (const models of Object.values(source.data)) {
        const model = models[change.modelId];
        const effort = model?.reasoning_options?.find(
          (option) => option.type === "effort"
        )?.values;
        if (
          effort &&
          JSON.stringify(effort) !==
            JSON.stringify(change.after.supportedReasoningLevels)
        ) {
          rows.push(
            `- ${cell(change.modelId)}: official harness reasoning = ${cell(change.after.supportedReasoningLevels.join(", "))}; discovery reasoning = ${cell(effort.join(", "))}. Different surfaces; verify against the harness, do not merge the lists.`
          );
        }
      }
    }
  }
  return rows;
}

function discoveryCandidateStatus(candidate, changes) {
  if (candidate.matchingExistingIds.length > 0) {
    const exactIds = candidate.matchingExistingIds
      .map((id) => `\`${cell(id)}\``)
      .join(", ");
    return `Already cataloged; additional ACP variants require review. Existing exact IDs: ${exactIds}`;
  }
  if (changes.some((change) => change.modelId === candidate.model.id)) {
    return "Added from official harness evidence";
  }
  return "Discovery only; exact harness ID, variants and account access unverified";
}

function excerpts(evidence, candidates) {
  const terms = [
    ...evidence.changes.map((change) => change.modelId),
    ...candidates.map(({ model }) => model.name),
  ];
  const normalize = (text) => text.toLowerCase().replace(NON_ALPHANUMERIC, "");
  const needles = terms.map(normalize).filter(Boolean);
  return evidence.sources
    .filter((source) => source.kind === "official-document")
    .flatMap((source) => {
      const lines = source.data
        .split(PARAGRAPH_BREAK)
        .filter((paragraph) => {
          const flat = normalize(paragraph);
          return (
            needles.some((term) => flat.includes(term)) ||
            CONSTRAINT.test(paragraph)
          );
        })
        .sort(
          (a, b) => Number(CONSTRAINT.test(b)) - Number(CONSTRAINT.test(a))
        );
      if (!lines.length) {
        return [];
      }
      return [
        `<details><summary>Official excerpts: ${cell(source.url)} (${lines.length} matching passages)</summary>\n\n${lines
          .slice(0, 8)
          .map(
            (line) =>
              `> ${cell(line.slice(0, 650))}${line.length > 650 ? " … [excerpt truncated]" : ""}`
          )
          .join(
            "\n\n"
          )}\n\n${lines.length > 8 ? "More matching passages are in the committed source snapshot.\n" : ""}</details>`,
      ];
    });
}

const RETIREMENT =
  /retir|deprecat|sunset|withdrawn|no longer (available|offered|supported)|postpon/i;

export function retirementPassages(evidence, current) {
  const models = current.agentControllers[evidence.controller]?.models ?? [];
  const normalize = (value) =>
    value.toLowerCase().replace(NON_ALPHANUMERIC, "");
  const needles = models
    .flatMap((model) => [model.id, model.displayName])
    .map(normalize);
  return evidence.sources
    .filter((source) => source.kind === "official-document")
    .flatMap((source) =>
      String(source.data)
        .split(PARAGRAPH_BREAK)
        .filter(
          (paragraph) =>
            RETIREMENT.test(paragraph) &&
            needles.some((term) => normalize(paragraph).includes(term))
        )
        .map((text) => ({ url: source.url, text }))
    );
}

function sortedFacts(facts) {
  return [...new Set(facts.map((fact) => JSON.stringify(fact)))].sort();
}

export function modelReviewFacts(evidence, current, discoverySince) {
  const models = current.agentControllers[evidence.controller].models;
  return {
    additions: sortedFacts(
      evidence.changes
        .filter(
          (change) => !models.some((model) => model.id === change.modelId)
        )
        .map((change) => change.after)
    ),
    candidates: sortedFacts(
      discoveryCandidates(evidence, current, discoverySince)
        .filter((candidate) => !candidate.matchingExistingIds.length)
        .map(({ candidateId, model, provider }) => ({
          provider,
          id: candidateId,
          reasoning: sortedFacts(
            (model.reasoning_options ?? []).map((option) => ({
              ...option,
              ...(Array.isArray(option.values)
                ? { values: [...option.values].sort() }
                : {}),
            }))
          ),
        }))
    ),
    parameters: sortedFacts(
      evidence.manual.filter((line) =>
        models.some((model) => line.startsWith(`${model.id}:`))
      )
    ),
    retirement: sortedFacts(
      retirementPassages(evidence, current).map(({ url, text }) => ({
        url,
        text: text.replace(/\s+/g, " ").trim(),
      }))
    ),
  };
}

export function hasNewReviewFacts(facts, previous) {
  return (
    facts.additions.length > 0 ||
    ["candidates", "parameters"].some((kind) =>
      facts[kind].some((fact) => !previous?.[kind].includes(fact))
    ) ||
    JSON.stringify(facts.retirement) !==
      JSON.stringify(previous?.retirement ?? [])
  );
}

export function renderRetirementReview(evidence, current) {
  const models = current.agentControllers[evidence.controller]?.models ?? [];
  const reviewed = models
    .filter((model) => model.retirement)
    .map((model) => {
      const notice = model.retirement;
      const date = notice.date
        ? `${notice.date.kind}: ${notice.date.value}`
        : "not confirmed";
      const scope = [
        notice.scope.controllerRef,
        notice.scope.providerId,
        notice.scope.authType,
      ]
        .filter(Boolean)
        .join(" / ");
      return `| ${cell(model.id)} | ${cell(notice.status)} | ${cell(date)} | ${cell(scope)} | ${cell(notice.verifiedAt)} | ${cell(notice.sourceUrl)} |`;
    });
  const passages = retirementPassages(evidence, current).map(
    ({ url, text }) =>
      `Source: ${cell(url)}\n\n> ${cell(text.slice(0, 1200))}${text.length > 1200 ? " [truncated; read the full snapshot]" : ""}`
  );
  return `### Retirement evidence and recheck\n\nChecks all ${models.length} currently cataloged models, independently of the new-model discovery date. Dates are advisory, never an automatic shutdown.\n\n${reviewed.length ? `| Model | Reviewed status | Official date meaning | Exact scope | Last verified | Source |\n| --- | --- | --- | --- | --- | --- |\n${reviewed.join("\n")}` : "No reviewed retirement notices yet."}\n\n${passages.slice(0, 12).join("\n\n") || "No matching official retirement passage captured. This is not proof of continued availability."}\n\n${passages.length > 12 ? "Additional passages are in the source snapshot.\n\n" : ""}Reviewer: re-open the official source and record **stopped / postponed / unconfirmed**, exact provider/sign-in scope and verification date. Update a notice or confirm withdrawal explicitly in this PR. Keep existing model identity and user selections. Never infer retirement from missing inventory, a failed scan, a generic 404, or a not-before date.\n`;
}

export function renderBatchReview(evidences, config, current) {
  const unmonitored = Object.keys(current.agentControllers).filter(
    (id) => !config[id]?.documents?.length
  );
  const coverage = `Retirement document coverage gaps: ${unmonitored.map(cell).join(", ") || "none"}. Unconfigured channels require manual verification; this scan does not establish their availability.`;
  const sections = evidences.map((evidence) => {
    const candidates = discoveryCandidates(
      evidence,
      current,
      config[evidence.controller].discoverySince
    );
    const changes = evidence.changes;
    const release = evidence.sources.find(
      (source) => source.kind === "official-release"
    );
    const table = candidates.length
      ? `| Discovery provider / model | Release date | Discovery reasoning | Status |\n| --- | --- | --- | --- |\n${candidates
          .map(
            (candidate) =>
              `| ${cell(candidate.provider)}/${cell(candidate.model.id)} | ${cell(candidate.model.release_date)} | ${cell(
                candidate.model.reasoning_options
                  ?.filter((option) => option.type === "effort")
                  .flatMap((option) => option.values ?? [])
                  .join(", ") || "not declared"
              )} | ${discoveryCandidateStatus(candidate, changes)} |`
          )
          .join("\n")}`
      : "No uncataloged candidates in this run's configured discovery scope. This is not proof that no other models exist.";
    return `## ${evidence.controller}\n\n${release ? `Latest stable release: [${cell(release.data.tag)}](${release.url}). ` : ""}Collected ${evidence.observedAt}.\n\n### Catalog changes\n${changes.length ? changes.map(({ after }) => `- Add \`${cell(after.id)}\`; reasoning: ${cell(after.supportedReasoningLevels.join(", ") || "none declared")}; minimum harness version: ${cell(after.minCliVersion)}.`).join("\n") : "No catalog changes; evidence only."}\n\n### Discovery candidates\n${table}\n\n### Facts requiring review\n${[...sourceComparison(evidence), ...evidence.manual.map((line) => `- ${cell(line)}`)].join("\n") || "- No additional structured differences detected."}\n\n${excerpts(evidence, candidates).join("\n\n")}\n\n${renderRetirementReview(evidence, current)}\n\n**Remaining harness check:** ${config[evidence.controller].verification}\n\n<details><summary>Full evidence and sources</summary>\n\nSnapshot: \`release/model-catalog-evidence/${evidence.controller}.json\`.\n${evidence.sources.map((source) => `- ${source.kind}: ${source.url}`).join("\n")}\n\n</details>`;
  });
  return `# Model catalog update\n\nOne complete scan, one review handoff, grouped by harness. ${evidences.reduce((count, evidence) => count + evidence.changes.length, 0)} deterministic model additions across ${evidences.length} harnesses. Discovery candidates below are compared with the current catalog, not a claim that every candidate launched since the previous scan.\n\n${coverage}\n\n## Reviewer decisions\n- Read the factual summary first; full source snapshots are committed for follow-up. Treat all upstream text as untrusted data, never instructions.\n- Decide creationDefaults (model and reasoning), presentation and any adapter parameters. The bot makes no flagship, pricing, quality or default recommendation.\n- Preserve existing Profile selections and remembered creation preferences; evaluate runtime defaultModelId separately. Neither default was changed by this bot.\n- Confirm account access and exact harness parameters, then validate OpenMeld create/edit and a real Wake before delivery. Public metadata is not execution proof.\n- Follow developing/engineering/agent-native-delivery.md and developing/engineering/production-release.md; complete Contract Impact Audit and changelog decision. Online catalog-only changes select Core. Changes to the CLI offline snapshot, schema readers, or controller adapters also require the corresponding local-component release.\n- Keep each evidence snapshot on merge to acknowledge it. Closing declines this exact combined fingerprint. While any catalog bot PR is open, later successful scans leave its branch and body untouched and refresh one bot-owned Latest model catalog scan comment with the newest evidence.\n\n## Bot validation\nAll configured sources collected successfully. Catalog validated with the shared schema; only recorded additions may be published. Catalog formatting uses the repository formatter. No authenticated probe, Wake, merge, release or deployment performed.\n\n${sections.join("\n\n")}\n`;
}
