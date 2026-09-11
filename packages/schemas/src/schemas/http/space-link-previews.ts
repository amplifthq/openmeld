import * as z from "zod/v4";

export const MAX_MESSAGE_LINK_PREVIEWS = 12;

const previewUrlSchema = z
  .url()
  .max(4096)
  .refine((value) => {
    const url = new URL(value);
    return (
      ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  });
const previewImageSchema = z
  .string()
  .max(350_000)
  .regex(
    /^data:image\/(?:png|jpeg|webp|gif|x-icon|vnd\.microsoft\.icon);base64,[A-Za-z0-9+/=]+$/
  )
  .nullable();

export const getSpaceLinkPreviewsInputSchema = z
  .object({
    spaceId: z.string().regex(/^[0-9a-f]{64}$/),
    signalId: z.string().min(1).max(256),
  })
  .strict();

export const spaceMessageLinksSchema = z
  .object({
    signalId: z.string(),
    revision: z.number().int().nonnegative(),
    urls: z.array(previewUrlSchema).max(MAX_MESSAGE_LINK_PREVIEWS),
  })
  .strict();

export const linkPreviewSchema = z
  .object({
    url: previewUrlSchema,
    title: z.string().max(300).nullable(),
    description: z.string().max(500).nullable(),
    siteName: z.string().max(100).nullable(),
    image: previewImageSchema,
    icon: previewImageSchema,
    status: z.enum(["available", "unavailable"]),
  })
  .strict();

export const getSpaceLinkPreviewsResponseSchema = z
  .object({
    signalId: z.string(),
    revision: z.number().int().nonnegative(),
    previews: z.array(linkPreviewSchema).max(MAX_MESSAGE_LINK_PREVIEWS),
  })
  .strict();

export type LinkPreview = z.infer<typeof linkPreviewSchema>;
export type SpaceMessageLinks = z.infer<typeof spaceMessageLinksSchema>;
export type GetSpaceLinkPreviewsResponse = z.infer<
  typeof getSpaceLinkPreviewsResponseSchema
>;
