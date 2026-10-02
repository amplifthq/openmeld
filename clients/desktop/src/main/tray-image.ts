import type { DesktopInboxAttention } from "@openmeld/schemas";
import { type NativeImage, nativeImage } from "electron";

export function trayAttentionTitle(
  attention: DesktopInboxAttention | null
): string {
  if (!attention) {
    return "";
  }
  const priority =
    attention.priorityCount ??
    attention.unresolvedActionCount + attention.unreadUrgentUpdateCount;
  return [
    ...(priority > 0 ? [`!${cappedCount(priority)}`] : []),
    ...(attention.unreadMentionCount > 0
      ? [`@${cappedCount(attention.unreadMentionCount)}`]
      : []),
  ].join(" ");
}

export function hasTrayUnreadDot(
  attention: DesktopInboxAttention | null
): boolean {
  return Boolean(
    attention &&
      !trayAttentionTitle(attention) &&
      (attention.ordinaryUnreadCount > 0 || attention.unresolvedActionCount > 0)
  );
}

function cappedCount(count: number): string {
  return count > 99 ? "99+" : String(count);
}

// macOS only. The ordinary unread dot is part of the template image, not a
// separately spaced NSStatusItem title. AppKit owns contrast and pressed-state
// rendering; no wallpaper sampling, hardcoded white, shadow or theme listener.
export function createTrayTemplateImage(
  logo: NativeImage,
  unread: boolean
): NativeImage {
  const image = nativeImage.createEmpty();
  for (const scale of [1, 2]) {
    const width = (unread ? 22 : 18) * scale;
    const height = 18 * scale;
    const bitmap = Buffer.alloc(width * height * 4);
    const pixels = logo.resize({ width: height, height }).toBitmap();
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const alpha =
          x < height
            ? (pixels[(y * height + x) * 4 + 3] ?? 0)
            : Math.round(
                255 *
                  Math.max(
                    0,
                    Math.min(
                      1,
                      1.5 * scale +
                        0.5 -
                        Math.hypot(x + 0.5 - 20 * scale, y + 0.5 - 9 * scale)
                    )
                  )
              );
        bitmap[(y * width + x) * 4 + 3] = alpha;
      }
    }
    image.addRepresentation({
      scaleFactor: scale,
      buffer: nativeImage.createFromBitmap(bitmap, { width, height }).toPNG(),
    });
  }
  image.setTemplateImage(true);
  return image;
}
