import type { CenterAgentUpdateProfileBody } from "@openmeld/schemas/types";
import {
  inspectIdentityImage,
  matchesIdentityImageMagicBytes,
  transformIdentityImage,
} from "./identity-image";

// Use the same decoder, dimension limits, and metadata-free output as account
// photos. The Core owner authorizes the mutation before storing these bytes.
export async function normalizeCenterAgentAvatarImage(
  avatar: NonNullable<CenterAgentUpdateProfileBody["avatar"]>,
  images: ImagesBinding
): Promise<NonNullable<CenterAgentUpdateProfileBody["avatar"]>> {
  if (avatar.kind !== "image") {
    return avatar;
  }
  const [header, encoded] = avatar.dataUrl.split(",");
  const mime = header === "data:image/png;base64" ? "image/png" : "image/webp";
  const bytes = Uint8Array.from(atob(encoded ?? ""), (char) =>
    char.charCodeAt(0)
  ).buffer;
  if (!matchesIdentityImageMagicBytes(bytes, mime)) {
    throw new Error("Choose a valid PNG or WebP image.");
  }
  const inspected = await inspectIdentityImage(images, bytes);
  if (!inspected.ok) {
    throw new Error(inspected.error.message);
  }
  const result = await transformIdentityImage(images, bytes);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  const output = new Uint8Array(
    await new Response(result.stream).arrayBuffer()
  );
  let binary = "";
  for (const byte of output) {
    binary += String.fromCharCode(byte);
  }
  return { kind: "image", dataUrl: `data:image/webp;base64,${btoa(binary)}` };
}
