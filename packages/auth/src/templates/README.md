# Transactional email templates

Run `pnpm -C packages/auth email:dev` from the repository root, then open
`http://localhost:3333`. The preview uses fictional data and never sends mail
unless a developer explicitly configures and uses the preview tool's Send action.

All six outgoing email families use the content functions in
`_components/content.ts` and the React Email layout in
`_components/action-email.tsx`. Production builders in
`../utils/email-templates.ts` render that same layout and supply a plain-text
alternative. Do not add separate HTML strings to a sender.

- Verification and magic link: Auth configuration.
- Organization invitation: Auth organization invitation callback.
- Space invitation: Auth Space invitation route.
- Invitation review and urgent Inbox: Auth Inbox delivery RPC.

Fluid styling is intentionally adapted to email: neutral colors, a flat surface,
8px corners, short copy, and one action. Use inline email-safe styles, not app
CSS variables, web fonts, animation, or client UI components. No remote image is
required to recognize the sender or act on the message.

Keep expiration, invitation role, destination, recipient authorization, and
notification preferences owned by the sending product. A preview is not proof
of inbox delivery or rendering in Gmail, Outlook, or Apple Mail.
