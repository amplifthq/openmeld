---
id: space-colleague-access
title: Join your team's Spaces without opening them to everyone
kind: improved
areas: ["spaces", "invitations"]
audiences: ["members", "admins"]
publishedAt: 2026-09-10
release: v0.3.198
evidence: ["https://github.com/amplifthq/openmeld/issues/886", "pr:935", "pr:937", "commit:0281b7b03c8259608bc1e296e727550ce09bdfa4", "workflow:34523839085", "workflow:34525984891", "workflow:34522614437", "workflow:34523312980", "workflow:34525506615"]
---

Organization members can join a Space open to their organization from Discover
or a shared link, even when its content is limited to Space members. Join
failures preserve the reason instead of replacing it with a generic error.

Share and Access settings share one compact panel for inviting teammates,
choosing who can join the Space, and copying its link. New Spaces keep content limited to members. Existing
external links show their current audience and can be closed by the owner.

Existing invitation links load when sharing opens and remain available after
collapsing the invitation section or reopening the dialog.

Space navigation stays inside the app. New invitation recipients can join their
organization and Space in one flow, then keep browsing without setup interrupting
the same visit.

Owners can invite signed-in external guests to just one Space, without adding
them to the organization. The sharing confirmation explains what guests can
read and do; turning off guest access also blocks existing guests.

Spaces support multiple owners. Add another owner before handing off your role
or leaving the organization, so your team's conversations and files stay with
the team. The final owner cannot be removed.
