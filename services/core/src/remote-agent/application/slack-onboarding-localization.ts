const WHITESPACE_PATTERN = /\s+/u;

export type SlackOnboardingLocale = "en" | "zh-Hans" | "zh-Hant";

export type SlackOnboardingActionLabels = {
  connectMoreContext: string;
  introduceInChannels: string;
  inviteTeammates: string;
  seeWhatILearned: string;
};

export function resolveSlackOnboardingLocale(
  languageTag?: string | null
): SlackOnboardingLocale {
  if (!languageTag) {
    return "en";
  }
  let locale: Intl.Locale;
  try {
    locale = new Intl.Locale(languageTag).maximize();
  } catch {
    return "en";
  }
  if (locale.language !== "zh") {
    return "en";
  }
  return locale.script === "Hant" ? "zh-Hant" : "zh-Hans";
}

export function getSlackOnboardingActionLabels(
  languageTag?: string | null
): SlackOnboardingActionLabels {
  switch (resolveSlackOnboardingLocale(languageTag)) {
    case "zh-Hans":
      return {
        connectMoreContext: "连接更多工作信息",
        introduceInChannels: "让我在频道中自我介绍",
        inviteTeammates: "邀请团队成员",
        seeWhatILearned: "看看我学到了什么",
      };
    case "zh-Hant":
      return {
        connectMoreContext: "連接更多工作資訊",
        introduceInChannels: "讓我在頻道中自我介紹",
        inviteTeammates: "邀請團隊成員",
        seeWhatILearned: "看看我學到了什麼",
      };
    default:
      return {
        connectMoreContext: "Connect more context",
        introduceInChannels: "Introduce me in channels",
        inviteTeammates: "Invite teammates",
        seeWhatILearned: "See what I learned",
      };
  }
}

export function buildLocalizedSlackResearchUnavailableWelcomeMessage(input: {
  displayName: string;
  languageTag?: string | null;
  organizationName: string;
  workspaceMoved?: boolean;
}): string {
  const locale = resolveSlackOnboardingLocale(input.languageTag);
  const name = resolveGreetingName(input.displayName, locale);
  if (locale === "zh-Hans") {
    const opening = input.workspaceMoved
      ? `你好，${name}——这个 Slack 工作区现在已经连接到 *${input.organizationName}*。`
      : `你好，${name}——欢迎来到 OpenMeld 中的 *${input.organizationName}*。`;
    return `${opening}

Center Agent 没能完成你的第一份 Profile Report，所以不会猜测你的工作情况。你现在仍然可以直接在这里与 Center Agent 对话。

回复“再试一次”，即可重新开始生成 Profile Report。`;
  }
  if (locale === "zh-Hant") {
    const opening = input.workspaceMoved
      ? `你好，${name}——這個 Slack 工作區現在已經連接到 *${input.organizationName}*。`
      : `你好，${name}——歡迎來到 OpenMeld 中的 *${input.organizationName}*。`;
    return `${opening}

Center Agent 沒能完成你的第一份 Profile Report，所以不會猜測你的工作情況。你現在仍然可以直接在這裡與 Center Agent 對話。

回覆「再試一次」，即可重新開始產生 Profile Report。`;
  }
  const opening = input.workspaceMoved
    ? `Hi ${name} — this Slack workspace is now connected to *${input.organizationName}*.`
    : `Hi ${name} — welcome to *${input.organizationName}* in OpenMeld.`;
  return `${opening}

Center Agent couldn’t finish your first Profile Report, so it won’t guess about your work. You can still talk to Center Agent here now.

Reply “try again” to start a fresh Profile Report.`;
}

export function buildLocalizedTrustFirstSlackWelcomeMessage(input: {
  firstObservation: string | null;
  hasUsefulEvidence: boolean;
  installerDisplayName: string;
  languageTag?: string | null;
  messageKind: "connected" | "moved";
  organizationName: string;
}): string {
  const locale = resolveSlackOnboardingLocale(input.languageTag);
  const name = resolveGreetingName(input.installerDisplayName, locale);
  if (locale === "zh-Hans") {
    const opening =
      input.messageKind === "moved"
        ? `你好，${name}——这个 Slack 工作区现在已经连接到 *${input.organizationName}*。我是这个组织的 Center Agent。`
        : `你好，${name}——我是 *${input.organizationName}* 的 Center Agent。`;
    const learningResult = input.hasUsefulEvidence
      ? `我已经开始了解你的工作，并创建了第一份 Profile Report，保存在我的电脑文件中。这样你就不必从头解释所有事情。${input.firstObservation ? `\n\n我目前了解到的一点：${input.firstObservation}` : ""}`
      : "我已经开始了解你的工作，并创建了第一份 Profile Report，保存在我的电脑文件中。目前还没有足够的信息让我作出更多判断，我不会凭空编造。";
    return `${opening}

OpenMeld 是人和 Agent 作为一个团队共同工作的地方。我会了解团队的工作方式，把重要背景整理在一起，并帮助推动工作向前进展。

${learningResult}

这只是一个起点。如果有任何内容不准确，直接在这里告诉我。我会随着我们一起工作继续学习。

你可以直接在这里与我对话。准备好之后，我也可以帮助你邀请团队成员，或者从团队使用的更多 App 中了解工作背景。`;
  }
  if (locale === "zh-Hant") {
    const opening =
      input.messageKind === "moved"
        ? `你好，${name}——這個 Slack 工作區現在已經連接到 *${input.organizationName}*。我是這個組織的 Center Agent。`
        : `你好，${name}——我是 *${input.organizationName}* 的 Center Agent。`;
    const learningResult = input.hasUsefulEvidence
      ? `我已經開始瞭解你的工作，並建立了第一份 Profile Report，儲存在我的電腦檔案中。這樣你就不必從頭解釋所有事情。${input.firstObservation ? `\n\n我目前瞭解到的一點：${input.firstObservation}` : ""}`
      : "我已經開始瞭解你的工作，並建立了第一份 Profile Report，儲存在我的電腦檔案中。目前還沒有足夠的資訊讓我作出更多判斷，我不會憑空編造。";
    return `${opening}

OpenMeld 是人和 Agent 作為一個團隊共同工作的地方。我會瞭解團隊的工作方式，把重要背景整理在一起，並協助推動工作向前進展。

${learningResult}

這只是一個起點。如果有任何內容不準確，直接在這裡告訴我。我會隨著我們一起工作繼續學習。

你可以直接在這裡與我對話。準備好之後，我也可以協助你邀請團隊成員，或者從團隊使用的更多 App 中瞭解工作背景。`;
  }
  const opening =
    input.messageKind === "moved"
      ? `Hi ${name} — this Slack workspace is now connected to *${input.organizationName}*. I’m its Center Agent.`
      : `Hi ${name} — I’m the Center Agent for *${input.organizationName}*.`;
  const learningResult = input.hasUsefulEvidence
    ? `I’ve already started getting to know your work. I made a first Profile Report and saved it as a file on my computer, so you don’t have to explain everything from scratch.${input.firstObservation ? `\n\nOne thing I picked up: ${input.firstObservation}` : ""}`
    : "I’ve already started getting to know your work. I made a first Profile Report and saved it as a file on my computer. I don’t have enough context to say much yet, and I won’t make things up.";
  return `${opening}

OpenMeld is a place where people and agents work as one team. I learn how your team works, keep the important context together, and help move work forward.

${learningResult}

This is just a starting point. If anything feels off, tell me here. I’ll learn as we work together.

You can talk to me right here. Whenever you’re ready, I can help invite your teammates or learn from more of the apps your team uses.`;
}

export function buildLocalizedJoinedMemberWelcomeMessage(input: {
  hasUsefulEvidence: boolean;
  languageTag?: string | null;
  observation: string | null;
  organizationName: string;
  targetDisplayName: string;
}): string {
  const locale = resolveSlackOnboardingLocale(input.languageTag);
  const name = resolveGreetingName(input.targetDisplayName, locale);
  if (locale === "zh-Hans") {
    const proof = input.hasUsefulEvidence
      ? `我已经开始了解你的工作，并创建了第一份 Profile Report，保存在我的电脑文件中。${input.observation ? `\n\n我目前了解到的一点：${input.observation}` : ""}`
      : "我已经开始了解你的工作，并创建了第一份 Profile Report，保存在我的电脑文件中。目前还没有足够的信息让我作出更多判断，我不会凭空编造。";
    return `你已加入，${name}——欢迎来到 OpenMeld 中的 *${input.organizationName}*。

${proof}

你可以直接在这里与我对话。告诉我你正在做什么，问问我已经了解了什么，或者让我帮助推动一件事情。如果我学到的内容有任何不准确，直接告诉我，我会继续学习。

准备好之后，我也可以帮助邀请更多团队成员，或者进一步了解团队使用的 App。`;
  }
  if (locale === "zh-Hant") {
    const proof = input.hasUsefulEvidence
      ? `我已經開始瞭解你的工作，並建立了第一份 Profile Report，儲存在我的電腦檔案中。${input.observation ? `\n\n我目前瞭解到的一點：${input.observation}` : ""}`
      : "我已經開始瞭解你的工作，並建立了第一份 Profile Report，儲存在我的電腦檔案中。目前還沒有足夠的資訊讓我作出更多判斷，我不會憑空編造。";
    return `你已加入，${name}——歡迎來到 OpenMeld 中的 *${input.organizationName}*。

${proof}

你可以直接在這裡與我對話。告訴我你正在做什麼，問問我已經瞭解了什麼，或者讓我協助推動一件事情。如果我學到的內容有任何不準確，直接告訴我，我會繼續學習。

準備好之後，我也可以協助邀請更多團隊成員，或者進一步瞭解團隊使用的 App。`;
  }
  const proof = input.hasUsefulEvidence
    ? `I’ve already started getting to know your work and made your first Profile Report. I saved it as a file on my computer.${input.observation ? `\n\nOne thing I picked up: ${input.observation}` : ""}`
    : "I’ve already started getting to know your work and made your first Profile Report. I saved it as a file on my computer. I don’t have enough context to say much yet, and I won’t make things up.";
  return `You’re in, ${name} — welcome to *${input.organizationName}* in OpenMeld.

${proof}

You can talk to me right here. Tell me what you’re working on, ask what I know, or ask me to help move something forward. If anything I learned feels off, just say so and I’ll keep learning.

When you’re ready, I can also help invite more teammates or get to know the apps your team uses.`;
}

function resolveGreetingName(
  displayName: string,
  locale: SlackOnboardingLocale
): string {
  const normalized = displayName.trim();
  if (!normalized) {
    return locale === "en" ? "there" : "朋友";
  }
  return locale === "en"
    ? normalized.split(WHITESPACE_PATTERN)[0] || "there"
    : normalized;
}
