export type TaskResultDeliverySemanticKind =
  | "success_like"
  | "failed_requires_classification";

export type TaskResultPayloadStatus = "success" | "partial_success" | "failed";

export type TaskResultDeliverySemantic = {
  kind: TaskResultDeliverySemanticKind;
  successLike: boolean;
};

const SUCCESS_LIKE_TASK_RESULT_DELIVERY_SEMANTIC = {
  kind: "success_like",
  successLike: true,
} as const satisfies TaskResultDeliverySemantic;

const FAILED_TASK_RESULT_DELIVERY_SEMANTIC = {
  kind: "failed_requires_classification",
  successLike: false,
} as const satisfies TaskResultDeliverySemantic;

export const isTaskResultStatusSuccessLike = (
  status: TaskResultPayloadStatus
): status is Extract<TaskResultPayloadStatus, "success" | "partial_success"> =>
  status === "success" || status === "partial_success";

export const resolveTaskResultDeliverySemantic = (input: {
  payloadStatus: TaskResultPayloadStatus;
}): TaskResultDeliverySemantic =>
  isTaskResultStatusSuccessLike(input.payloadStatus)
    ? SUCCESS_LIKE_TASK_RESULT_DELIVERY_SEMANTIC
    : FAILED_TASK_RESULT_DELIVERY_SEMANTIC;
