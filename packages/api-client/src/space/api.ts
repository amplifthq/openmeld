import type { OpenMeldApiClientFoundation } from "../client";
import { setSpaceAccessMode } from "./access-mode";
import { addSpaceMembers } from "./add-members";
import { respondToSpaceAgentInteraction } from "./agent-interaction";
import { uploadSpaceAttachment } from "./attachments";
import { getSpaceBootstrap } from "./bootstrap";
import { createSpace } from "./create";
import { deleteConversationForMe, deleteSpace } from "./delete";
import { createSpaceDiagnosticReport } from "./diagnostic-report";
import { resolveSpaceEntry } from "./entry-resolution";
import {
  executeSpaceExecutionRecovery,
  inspectSpaceExecutionRecovery,
} from "./execution-recovery";
import { spaceFileUpdateSettings } from "./file-update-settings";
import {
  createSpaceFolder,
  discardSpaceComposerUpload,
  downloadSpaceFileContent,
  getSpaceFile,
  listSpaceFileRevisions,
  listSpaceFiles,
  publishSpaceComposerUpload,
  restoreSpaceFileEntry,
  restoreSpaceFileRevision,
  stageSpaceComposerUpload,
  streamSpaceFileContent,
  trashSpaceFileEntry,
  updateSpaceFileContent,
  updateSpaceFileEntry,
  uploadSpaceFile,
} from "./files";
import { getSpaceHistoryNavigation } from "./history-navigation";
import { leaveSpace } from "./leave";
import { getSpaceLinkPreviews } from "./link-previews";
import {
  addCenterAgentToSpace,
  addOrganizationDirectoryProfilesToSpace,
  getSpaceIdentityDirectory,
  getSpaceMemberDirectory,
  getSpaceMembersSnapshot,
  getSpaceViewerMembership,
  joinSpace,
} from "./members";
import { getSpaceMessageDetails } from "./message-details";
import {
  getSpaceMessageReactions,
  setSpaceMessageReaction,
} from "./message-reactions";
import { getSpaceMeta, updateSpaceMeta } from "./meta";
import { mutateSpaceMessage } from "./mutate-message";
import { postSpaceNormalMessage } from "./post-normal-message";
import { removeSpaceMembers } from "./remove-members";
import { listSpaceSignalEnvelopes, listSpaceSignals } from "./signals";
import { getSpaceStatus } from "./status";
import {
  createSpaceTask,
  getSpaceTask,
  listSpaceTasks,
  mutateSpaceTask,
} from "./tasks";
import {
  createSpaceThread,
  getSpaceThread,
  listSpaceThreadEvents,
  listSpaceThreadSignals,
  listSpaceThreads,
  postSpaceThreadSignal,
} from "./threads";
import type { CreateSpaceApi } from "./types";
import { getSpaceUpdates } from "./updates";
import {
  getActiveSpaceWakeProgress,
  getSpaceWakeProgress,
} from "./wake-progress";
import { postSpaceWakeStop } from "./wake-stop";
import { getSpaceWakeTraceWaterfall } from "./wake-trace-waterfall";

export const createSpaceApi: CreateSpaceApi = (
  client: OpenMeldApiClientFoundation
) => {
  return {
    createSpace: async (input) => await createSpace(client, input),
    deleteSpace: async (input) => await deleteSpace(client, input),
    deleteConversationForMe: async (input) =>
      await deleteConversationForMe(client, input),
    joinSpace: async (input) => await joinSpace(client, input),
    addMembers: async (input) => await addSpaceMembers(client, input),
    addCenterAgentToSpace: async (input) =>
      await addCenterAgentToSpace(client, input),
    addOrganizationDirectoryProfilesToSpace: async (input) =>
      await addOrganizationDirectoryProfilesToSpace(client, input),
    uploadAttachment: async (input) =>
      await uploadSpaceAttachment(client, input),
    listFiles: async (input) => await listSpaceFiles(client, input),
    getFile: async (input) => await getSpaceFile(client, input),
    fileUpdateSettings: async (input) =>
      await spaceFileUpdateSettings(client, input),
    listFileRevisions: async (input) =>
      await listSpaceFileRevisions(client, input),
    createFolder: async (input) => await createSpaceFolder(client, input),
    updateFileEntry: async (input) => await updateSpaceFileEntry(client, input),
    trashFileEntry: async (input) => await trashSpaceFileEntry(client, input),
    restoreFileEntry: async (input) =>
      await restoreSpaceFileEntry(client, input),
    restoreFileRevision: async (input) =>
      await restoreSpaceFileRevision(client, input),
    uploadFile: async (input) => await uploadSpaceFile(client, input),
    stageComposerUpload: async (input) =>
      await stageSpaceComposerUpload(client, input),
    publishComposerUpload: async (input) =>
      await publishSpaceComposerUpload(client, input),
    discardComposerUpload: async (input) =>
      await discardSpaceComposerUpload(client, input),
    updateFileContent: async (input) =>
      await updateSpaceFileContent(client, input),
    downloadFileContent: async (input) =>
      await downloadSpaceFileContent(client, input),
    streamFileContent: async (input) =>
      await streamSpaceFileContent(client, input),
    removeMembers: async (input) => await removeSpaceMembers(client, input),
    setAccessMode: async (input) => await setSpaceAccessMode(client, input),
    getMeta: async (input) => await getSpaceMeta(client, input),
    updateMeta: async (input) => await updateSpaceMeta(client, input),
    leaveSpace: async (input) => await leaveSpace(client, input),
    getBootstrap: async (input) => await getSpaceBootstrap(client, input),
    getStatus: async (input) => await getSpaceStatus(client, input),
    resolveEntry: async (input) => await resolveSpaceEntry(client, input),
    getMembersSnapshot: async (input) =>
      await getSpaceMembersSnapshot(client, input),
    getMemberDirectory: async (input) =>
      await getSpaceMemberDirectory(client, input),
    getHistoryNavigation: async (input) =>
      await getSpaceHistoryNavigation(client, input),
    getIdentityDirectory: async (input) =>
      await getSpaceIdentityDirectory(client, input),
    getViewerMembership: async (input) =>
      await getSpaceViewerMembership(client, input),
    listSignals: async (input) => await listSpaceSignals(client, input),
    listSignalEnvelopes: async (input) =>
      await listSpaceSignalEnvelopes(client, input),
    getUpdates: async (input) => await getSpaceUpdates(client, input),
    getActiveWakeProgress: async (input) =>
      await getActiveSpaceWakeProgress(client, input),
    postWakeStop: async (input) => await postSpaceWakeStop(client, input),
    inspectExecutionRecovery: async (input) =>
      await inspectSpaceExecutionRecovery(client, input),
    executeExecutionRecovery: async (input) =>
      await executeSpaceExecutionRecovery(client, input),
    respondToAgentInteraction: async (input) =>
      await respondToSpaceAgentInteraction(client, input),
    getWakeProgress: async (input) => await getSpaceWakeProgress(client, input),
    getWakeTraceWaterfall: async (input) =>
      await getSpaceWakeTraceWaterfall(client, input),
    getMessageReactions: (input) => getSpaceMessageReactions(client, input),
    setMessageReaction: (input) => setSpaceMessageReaction(client, input),
    getMessageDetails: async (input) =>
      await getSpaceMessageDetails(client, input),
    getLinkPreviews: (input) => getSpaceLinkPreviews(client, input),
    createDiagnosticReport: async (input) =>
      await createSpaceDiagnosticReport(client, input),
    mutateMessage: (input) => mutateSpaceMessage(client, input),
    postNormalMessage: async (input) =>
      await postSpaceNormalMessage(client, input),
    createThread: async (input) => await createSpaceThread(client, input),
    listThreads: async (input) => await listSpaceThreads(client, input),
    getThread: async (input) => await getSpaceThread(client, input),
    listThreadEvents: async (input) =>
      await listSpaceThreadEvents(client, input),
    listThreadSignals: async (input) =>
      await listSpaceThreadSignals(client, input),
    postThreadSignal: async (input) =>
      await postSpaceThreadSignal(client, input),
    listTasks: async (input) => await listSpaceTasks(client, input),
    getTask: async (input) => await getSpaceTask(client, input),
    createTask: async (input) => await createSpaceTask(client, input),
    mutateTask: async (input) => await mutateSpaceTask(client, input),
  };
};
