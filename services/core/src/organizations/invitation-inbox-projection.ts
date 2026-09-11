/** Source-owned reconciliation preserves personal read and dismissal state. */
export async function reconcileInvitationInbox(
  db: D1Database,
  organizationId: string
) {
  await db
    .prepare(`
    WITH invitation_attention AS (
      SELECT id, organization_id,
        CASE WHEN status = 'approved' AND invitation_sent_at IS NULL AND joined_at IS NULL THEN 'system_issue' ELSE 'organization_request' END AS kind,
        CASE status WHEN 'pending' THEN 'Invite ' WHEN 'approved' THEN 'Approved invitation: ' WHEN 'rejected' THEN 'Declined invitation: ' ELSE 'Cancelled invitation: ' END || email AS title,
        CASE
          WHEN status = 'pending' THEN 'Review this request to invite a member.'
          WHEN joined_at IS NOT NULL THEN 'Approved. The applicant has joined.'
          WHEN invitation_sent_at IS NOT NULL THEN 'Invitation sent.'
          WHEN status = 'approved' THEN 'Approved. Joining or invitation delivery still needs to be completed.'
          WHEN status = 'rejected' THEN 'This invitation request was declined.'
          ELSE 'This invitation request was cancelled.' END AS preview,
        CASE WHEN status = 'pending' OR (status = 'approved' AND invitation_sent_at IS NULL AND joined_at IS NULL) THEN 'open' ELSE 'resolved' END AS resolution,
        coalesce(joined_at, invitation_sent_at, reviewed_at) AS outcome_at,
        max(coalesce(reviewed_at, created_at), coalesce(invitation_sent_at, 0), coalesce(joined_at, 0)) AS updated_at
      FROM organization_join_requests WHERE organization_id = ?
    )
    UPDATE inbox_items AS item SET kind = request.kind, importance = 'normal',
      title = request.title, preview = request.preview, resolution_status = request.resolution,
      resolved_at_ms = CASE WHEN request.resolution = 'resolved' THEN request.outcome_at ELSE NULL END,
      updated_at_ms = max(item.updated_at_ms, request.updated_at)
    FROM invitation_attention AS request
    WHERE item.organization_id = request.organization_id
      AND item.source_kind = 'organization_member_request'
      AND item.source_key = 'invitation:' || request.id
      AND (item.importance != 'normal' OR item.kind != request.kind
        OR item.title != request.title OR item.preview != request.preview
        OR item.resolution_status != request.resolution)
  `)
    .bind(organizationId)
    .run();
}
