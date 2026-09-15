export type AuthClientError = {
	code?: string;
	description?: string;
	message?: string;
	status?: number;
	statusText?: string;
	[key: string]: unknown;
};

export type AuthSessionRecord = {
	id?: string;
	token?: string;
	createdAt?: string | Date;
	updatedAt?: string | Date;
	expiresAt?: string | Date;
	ipAddress?: string | null;
	userAgent?: string | null;
	[key: string]: unknown;
};

export type AuthSessionUser = {
	id?: string;
	email?: string;
	name?: string;
	image?: string | null;
	emailVerified?: boolean;
	createdAt?: string | Date;
	updatedAt?: string | Date;
	[key: string]: unknown;
};

export type AuthDeviceSession = {
	session: AuthSessionRecord & {
		token: string;
		userId: string;
	};
	user: AuthSessionUser & {
		email: string;
		id: string;
		name: string;
	};
};

export type AuthAccount = {
	accountId?: string;
	provider?: string;
	providerId?: string;
	id?: string;
	[key: string]: unknown;
};

export type AuthPasskey = {
	id: string;
	name?: string | null;
	deviceType?: string | null;
	backedUp?: boolean;
	createdAt?: string | Date | null;
	[key: string]: unknown;
};
