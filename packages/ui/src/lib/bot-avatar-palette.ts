import { type BotAvatarType, botAvatarPresets, shade } from "bot-avatars";

export const BOT_AVATAR_PALETTES = [
  {
    value: "original",
    label: "Original",
    description: "Bright colors for each Bot.",
  },
  {
    value: "balanced",
    label: "Balanced",
    description: "Colorful, with softer tones.",
  },
  { value: "soft", label: "Soft", description: "Muted colors for each Bot." },
  { value: "slate", label: "Slate", description: "Cool blue-gray tones." },
  { value: "sand", label: "Sand", description: "Warm neutral tones." },
] as const;

export type BotAvatarPalette = (typeof BOT_AVATAR_PALETTES)[number]["value"];

// Shared by the website, saved avatars, and the avatar editor. Material lighting
// must not add saturation to these colors.
const softColors = {
  clover: "#7BAFC9",
  flower: "#99B8A5",
  triangle: "#B2A0C3",
  square: "#8AAFC8",
  blob: "#A3B7A7",
  ghost: "#C4BECE",
  circle: "#ADA3C5",
  drop: "#93B9B5",
  star: "#CEC095",
  droid: "#B8BBC9",
  mech: "#95A6BC",
  alien: "#ADBC99",
  hexagon: "#C49F9E",
  cat: "#C8BDA9",
  cloud: "#C2C8D2",
  pill: "#B1ADC8",
  pebble: "#A7BCC5",
  puddle: "#C4A7BC",
} satisfies Record<BotAvatarType, string>;

export function botAvatarColor(
  type: BotAvatarType,
  palette: BotAvatarPalette = "soft"
) {
  if (palette === "slate") {
    return "#A3B0C1";
  }
  if (palette === "sand") {
    return "#C4B9A7";
  }
  if (palette === "original") {
    return shade(botAvatarPresets[type].color, 0, 0.25);
  }
  if (palette === "balanced") {
    return shade(softColors[type], 0, 0.125);
  }
  return softColors[type];
}
