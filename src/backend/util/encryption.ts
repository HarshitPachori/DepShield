const ALGORITHM = 'AES-GCM';

export const encryptToken = async (token: string, key: string): Promise<string> => {
	const cryptoKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(key.padEnd(32).slice(0, 32)), ALGORITHM, false, [
		'encrypt',
	]);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const encrypted = await crypto.subtle.encrypt({ name: ALGORITHM, iv }, cryptoKey, new TextEncoder().encode(token));
	const combined = new Uint8Array(iv.length + encrypted.byteLength);
	combined.set(iv);
	combined.set(new Uint8Array(encrypted), iv.length);
	return btoa(String.fromCharCode(...combined));
};

export const decryptToken = async (encrypted: string, key: string): Promise<string> => {
	const combined = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
	const iv = combined.slice(0, 12);
	const data = combined.slice(12);
	const cryptoKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(key.padEnd(32).slice(0, 32)), ALGORITHM, false, [
		'decrypt',
	]);
	const decrypted = await crypto.subtle.decrypt({ name: ALGORITHM, iv }, cryptoKey, data);
	return new TextDecoder().decode(decrypted);
};
