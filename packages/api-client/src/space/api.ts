import type { OpenMeldApiClientFoundation } from "../client";
import { setSpaceAccessMode } from "./access-mode";
import { addSpaceMembers } from "./add-members";
import { respondToSpaceAgentInteraction } from "./agent-interaction";
import { uploadSpaceAttachment } from "./attachments";
import { getSpaceBootstrap } from "./bootstrap";
import { createSpace } from "./create";
import { deleteSpace } from "./delete";
import { createSpaceDiagnosticReport } from "./diagnostic-report";
import {
  executeSpaceExecutionRecovery,
  inspectSpaceExecutionRecovery,
} from "./execution-recovery";
import {
  createSpaceFolder,
  downloadSpaceFileContent,
  getSpaceFile,
  listSpaceFileRevisions,
  listSpaceFiles,
  restoreSpaceFileEntry,
  restoreSpaceFileRevision,
  trashSpaceFileEntry,
  updateSpaceFileContent,
  updateSpaceFileEntry,
  uploadSpaceFile,
} from "./files";
import { leaveSpace } from "./leave";
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
import { updateSpaceMeta } from "./meta";
import { postSpaceNormalMessage } from "./post-normal-message";
import { removeSpaceMembers } from "./remove-members";
import { listSpaceSignalEnvelopes, listSpaceSignals } from "./signals";
import { getSpaceStatus } from "./status";
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
    updateFileContent: async (input) =>
      await updateSpaceFileContent(client, input),
    downloadFileContent: async (input) =>
      await downloadSpaceFileContent(client, input),
    removeMembers: async (input) => await removeSpaceMembers(client, input),
    setAccessMode: async (input) => await setSpaceAccessMode(client, input),
    updateMeta: async (input) => await updateSpaceMeta(client, input),
    leaveSpace: async (input) => await leaveSpace(client, input),
    getBootstrap: async (input) => await getSpaceBootstrap(client, input),
    getStatus: async (input) => await getSpaceStatus(client, input),
    getMembersSnapshot: async (input) =>
      await getSpaceMembersSnapshot(client, input),
    getMemberDirectory: async (input) =>
      await getSpaceMemberDirectory(client, input),
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
    getMessageDetails: async (input) =>
      await getSpaceMessageDetails(client, input),
    createDiagnosticReport: async (input) =>
      await createSpaceDiagnosticReport(client, input),
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
  };
};
