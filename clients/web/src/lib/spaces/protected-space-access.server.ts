import { normalizeSpacePasswordText } from "@openmeld/schemas";
import { deleteCookie, setCookie } from "@tanstack/react-start/server";
import { z } from "zod/v4";

const PROTECTED_SPACE_ACCESS_COOKIE_PREFIX = "openmeld_space_access_";
const PROTECTED_SPACE_ACCESS_MAX_AGE_SECONDS = 60 * 60 * 4;
const AES_GCM_IV_LENGTH = 12;
const BASE64_PLUS_PATTERN = /\+/g;
const BASE64_SLASH_PATTERN = /\//g;
const BASE64_URL_PADDING_PATTERN = /=+$/u;
const BASE64_URL_HYPHEN_PATTERN = /-/g;
const BASE64_URL_UNDERSCORE_PATTERN = /_/g;

const protectedSpaceAccessPayloadSchema = z.strictObject({
	v: z.literal(1),
	spaceId: z.string().min(1),
	password: z
		.string()
		.transform(normalizeSpacePasswordText)
		.pipe(z.string().min(1)),
	issuedAtMs: z.number().int().nonnegative(),
});

export const protectedSpaceAccessInputSchema = z.strictObject({
	spaceId: z.string().min(1),
	password: z
		.string()
		.transform(normalizeSpacePasswordText)
		.pipe(z.string().min(1)),
});

type ProtectedSpaceAccessPayload = z.infer<
	typeof protectedSpaceAccessPayloadSchema
>;

export type ProtectedSpaceAccessResolution =
	| {
			status: "available";
			password: string;
			cookieName: string;
	  }
	| {
			status: "missing";
			cookieName: string;
	  }
	| {
			status: "invalid";
			cookieName: string;
	  };

export function createProtectedSpaceAccessCookieName(spaceId: string): string {
	return `${PROTECTED_SPACE_ACCESS_COOKIE_PREFIX}${spaceId}`;
}

export async function encodeProtectedSpaceAccessCookieValue(input: {
	spaceId: string;
	password: string;
	secret: string;
}): Promise<string> {
	const payload: ProtectedSpaceAccessPayload = {
		v: 1,
		spaceId: input.spaceId,
		password: normalizeSpacePasswordText(input.password),
		issuedAtMs: Date.now(),
	};
	const key = await deriveProtectedSpaceAccessKey(input.secret);
	const iv = getCryptoOrThrow().getRandomValues(
		new Uint8Array(AES_GCM_IV_LENGTH)
	);
	const encrypted = await getCryptoOrThrow().subtle.encrypt(
		{
			name: "AES-GCM",
			iv,
		},
		key,
		new TextEncoder().encode(JSON.stringify(payload))
	);

	return `${encodeBase64Url(iv)}.${encodeBase64Url(new Uint8Array(encrypted))}`;
}

export async function resolveProtectedSpaceAccessFromCookieHeader(input: {
	spaceId: string;
	cookieHeader: string | null;
	secret: string;
}): Promise<ProtectedSpaceAccessResolution> {
	const cookieName = createProtectedSpaceAccessCookieName(input.spaceId);
	const cookieValue = readCookieValue(input.cookieHeader, cookieName);

	if (!cookieValue) {
		return {
			status: "missing",
			cookieName,
		};
	}

	const payload = await decodeProtectedSpaceAccessCookieValue({
		cookieValue,
		secret: input.secret,
	});
	if (!payload || payload.spaceId !== input.spaceId) {
		return {
			status: "invalid",
			cookieName,
		};
	}

	return {
		status: "available",
		password: payload.password,
		cookieName,
	};
}

export async function writeProtectedSpaceAccessCookie(input: {
	spaceId: string;
	password: string;
	secret: string;
	webAppUrl: string;
}): Promise<void> {
	const value = await encodeProtectedSpaceAccessCookieValue({
		spaceId: input.spaceId,
		password: input.password,
		secret: input.secret,
	});

	setCookie(createProtectedSpaceAccessCookieName(input.spaceId), value, {
		httpOnly: true,
		maxAge: PROTECTED_SPACE_ACCESS_MAX_AGE_SECONDS,
		path: "/",
		sameSite: "lax",
		secure: isSecureCookieUrl(input.webAppUrl),
	});
}

export function clearProtectedSpaceAccessCookie(input: {
	spaceId: string;
	webAppUrl: string;
}): void {
	deleteCookie(createProtectedSpaceAccessCookieName(input.spaceId), {
		path: "/",
		sameSite: "lax",
		secure: isSecureCookieUrl(input.webAppUrl),
	});
}

export function createExpiredProtectedSpaceAccessCookieHeader(input: {
	spaceId: string;
	webAppUrl: string;
}): string {
	return serializeCookie({
		name: createProtectedSpaceAccessCookieName(input.spaceId),
		value: "",
		maxAge: 0,
		secure: isSecureCookieUrl(input.webAppUrl),
	});
}

export function shouldClearProtectedSpaceAccessFromErrorBody(
	rawBody: string
): boolean {
	const parsed = z
		.strictObject({
			error: z.strictObject({
				code: z.string().min(1),
			}),
		})
		.safeParse(parseJson(rawBody));

	if (!parsed.success) {
		return false;
	}

	return (
		parsed.data.error.code === "space.password_required" ||
		parsed.data.error.code === "space.password_invalid"
	);
}

async function decodeProtectedSpaceAccessCookieValue(input: {
	cookieValue: string;
	secret: string;
}): Promise<ProtectedSpaceAccessPayload | null> {
	const [ivRaw, encryptedRaw] = input.cookieValue.split(".");
	if (!(ivRaw && encryptedRaw)) {
		return null;
	}

	try {
		const key = await deriveProtectedSpaceAccessKey(input.secret);
		const ivBuffer = toArrayBuffer(decodeBase64Url(ivRaw));
		const encryptedBuffer = toArrayBuffer(decodeBase64Url(encryptedRaw));
		const decrypted = await getCryptoOrThrow().subtle.decrypt(
			{
				name: "AES-GCM",
				iv: ivBuffer,
			},
			key,
			encryptedBuffer
		);
		const parsed = protectedSpaceAccessPayloadSchema.safeParse(
			JSON.parse(new TextDecoder().decode(decrypted))
		);

		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}

async function deriveProtectedSpaceAccessKey(
	secret: string
): Promise<CryptoKey> {
	const digest = await getCryptoOrThrow().subtle.digest(
		"SHA-256",
		new TextEncoder().encode(secret)
	);

	return await getCryptoOrThrow().subtle.importKey(
		"raw",
		digest,
		{
			name: "AES-GCM",
		},
		false,
		["encrypt", "decrypt"]
	);
}

function getCryptoOrThrow(): Crypto {
	if (!globalThis.crypto?.subtle) {
		throw new Error("Web Crypto is not available for protected space access.");
	}

	return globalThis.crypto;
}

function isSecureCookieUrl(webAppUrl: string): boolean {
	return new URL(webAppUrl).protocol === "https:";
}

function serializeCookie(input: {
	name: string;
	value: string;
	maxAge: number;
	secure: boolean;
}): string {
	const parts = [
		`${input.name}=${input.value}`,
		"HttpOnly",
		`Max-Age=${input.maxAge}`,
		"Path=/",
		"SameSite=Lax",
	];

	if (input.secure) {
		parts.push("Secure");
	}

	return parts.join("; ");
}

function readCookieValue(
	cookieHeader: string | null,
	cookieName: string
): string | null {
	if (!cookieHeader) {
		return null;
	}

	for (const cookiePart of cookieHeader.split(";")) {
		const separatorIndex = cookiePart.indexOf("=");
		if (separatorIndex === -1) {
			continue;
		}

		const name = cookiePart.slice(0, separatorIndex).trim();
		if (name !== cookieName) {
			continue;
		}

		return cookiePart.slice(separatorIndex + 1).trim();
	}

	return null;
}

function encodeBase64Url(bytes: Uint8Array): string {
	const base64 = encodeBase64(bytes);
	return base64
		.replace(BASE64_PLUS_PATTERN, "-")
		.replace(BASE64_SLASH_PATTERN, "_")
		.replace(BASE64_URL_PADDING_PATTERN, "");
}

function decodeBase64Url(value: string): Uint8Array {
	const base64 = value
		.replace(BASE64_URL_HYPHEN_PATTERN, "+")
		.replace(BASE64_URL_UNDERSCORE_PATTERN, "/");
	const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
	return decodeBase64(padded);
}

function encodeBase64(bytes: Uint8Array): string {
	if (typeof Buffer !== "undefined") {
		return Buffer.from(bytes).toString("base64");
	}

	let output = "";
	for (const byte of bytes) {
		output += String.fromCharCode(byte);
	}

	return btoa(output);
}

function decodeBase64(value: string): Uint8Array {
	if (typeof Buffer !== "undefined") {
		return new Uint8Array(Buffer.from(value, "base64"));
	}

	const decoded = atob(value);
	return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	if (
		bytes.buffer instanceof ArrayBuffer &&
		bytes.byteOffset === 0 &&
		bytes.byteLength === bytes.buffer.byteLength
	) {
		return bytes.buffer;
	}

	return bytes.slice().buffer;
}

function parseJson(rawBody: string): unknown {
	if (!rawBody.trim()) {
		return null;
	}

	try {
		return JSON.parse(rawBody);
	} catch {
		return null;
	}
}
