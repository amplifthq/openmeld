import {
  type BotAvatarType,
  botAvatarParts,
  botAvatarPresets,
  botAvatarShapes,
} from "bot-avatars";
import { type BotAvatarPalette, botAvatarColor } from "./bot-avatar-palette";

// A vector first frame is visible in server-rendered HTML, before the canvas
// renderer hydrates. Reuse the vendor's geometry and face placement at any size.
export function botAvatarPoster(
  type: BotAvatarType,
  palette: BotAvatarPalette
) {
  const color = botAvatarColor(type, palette);
  const { faceX, faceY, faceScale } = botAvatarPresets[type];
  const parts = botAvatarParts[type];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 150 150"><defs><radialGradient id="body" cx="30%" cy="20%" r="85%"><stop stop-color="${color}"/><stop offset="1" stop-color="${color}" stop-opacity=".65"/></radialGradient></defs><g transform="translate(25 35)">${parts ? `<path d="${parts}" fill="${color}"/>` : ""}<path d="${botAvatarShapes[type]}" fill="url(#body)"/><g transform="translate(${faceX} ${faceY}) scale(${faceScale})" fill="#242431"><ellipse cx="-9" rx="3.5" ry="5"/><ellipse cx="9" rx="3.5" ry="5"/></g></g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
