export type StartCliOptions = {
  profile?: string;
  profileId?: string;
  kind?: string;
  profileName?: string;
  agentName?: string;
  agentModel?: string;
  agentOwner?: string;
  gatewayUrl?: string;
  startSession?: string;
  skillsMode?: string;
  view?: string;
};

export type SkillsInstallCliOptions = {
  all?: boolean;
  agent?: string[];
  dir?: string;
  guide?: boolean;
};

export type SkillsUninstallCliOptions = {
  all?: boolean;
  agent?: string[];
  dir?: string;
  dryRun?: boolean;
  allowExternalTargets?: boolean;
};

export type AgentsEnableCliOptions = {
  all?: boolean;
  agent?: string[];
  install?: string;
};

export type AgentsConfigCliOptions = {
  enabled?: string;
};

export type AgentsCustomAddCliOptions = {
  id?: string;
  name?: string;
  dir?: string;
};

export type AgentsCustomUpdateCliOptions = {
  id?: string;
  name?: string;
  dir?: string;
};

export type AgentsCustomRemoveCliOptions = {
  id?: string;
};

export type ResetCliOptions = {
  yes?: boolean;
};

export type UninstallCliOptions = {
  yes?: boolean;
  force?: boolean;
  allLanes?: boolean;
  keepSkills?: boolean;
  removeSkills?: boolean;
  keepAuthTokens?: boolean;
  removeAuthTokens?: boolean;
  internalSafeValidation?: boolean;
};

export type UpgradeCliOptions = {
  yes?: boolean;
  check?: boolean;
  internalAlignService?: boolean;
};

export type AuthLoginCliOptions = {
  authUrl?: string;
  clientId?: string;
  open?: boolean;
  method?: string;
  ott?: string;
};

export type ComputerRenameCliOptions = {
  clear?: boolean;
};

export type FeedbackCliOptions = {
  category?: string;
  details?: string;
  email?: string;
  as?: string;
  context?: boolean;
  inboxKey?: string;
  json?: boolean;
};

export type ViewCliOptions = {
  profile?: string;
};

export type SpaceAddMembersCliOptions = {
  profile?: string;
  member?: string | string[];
  agentProfile?: string | string[];
  humanProfile?: string | string[];
  all?: boolean;
  password?: string;
  details?: boolean;
};

export type SpaceAddMeCliOptions = {
  profile?: string;
  projectFolder?: string[];
  workspacePath?: string[];
  workingDirectory?: string[];
  cwd?: string[];
  password?: string;
  agentControllerPermissionMode?: string;
  confirmDangerousAgentControllerPermissionMode?: boolean;
  details?: boolean;
  json?: boolean;
  model?: string;
  reasoningEffort?: string;
};

export type SpaceRemoveMembersCliOptions = {
  profile?: string;
  member?: string | string[];
  all?: boolean;
  password?: string;
};

export type SpaceLeaveCliOptions = {
  profile?: string;
  password?: string;
};

export type ServiceRunCliOptions = {
  deviceId?: string;
  gatewayUrl?: string;
  heartbeatMs?: string;
  profile?: string;
  mode?: string;
};

export type ServiceControlCliOptions = {
  dispatch?: string;
  reason?: string;
  task?: string;
};

export type ServiceStopCliOptions = {
  force?: boolean;
  profile?: string;
};

export type ServiceReinstallCliOptions = {
  force?: boolean;
};

export type ServiceSnapshotCliOptions = {
  profile?: string;
};

export type ServiceTraceCliOptions = {
  clientMessage?: string;
  details?: boolean;
  dispatch?: string;
  gatewayUrl?: string;
  password?: string;
  profile?: string;
  space?: string;
  sourceSignal?: string;
  targetProfile?: string;
};
