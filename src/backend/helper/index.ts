import { Ecosystem } from '@/types';

// Pre-compiled global regexes to save compilation CPU overhead inside functions
const PYTHON_LINE_REGEX = /^([a-zA-Z0-9_-]+)([>=<!]=?.*)?$/;
const GRADLE_SHORT_REGEX = /(?:implementation|api|compile|runtimeOnly|testImplementation|testCompile)\s+['"]([^'"]+)['"]/g;
const GRADLE_LONG_REGEX =
	/(?:implementation|api|compile|testImplementation)\s+group:\s*['"]([^'"]+)['"]\s*,\s*name:\s*['"]([^'"]+)['"]\s*,\s*version:\s*['"]([^'"]+)['"]/g;
const GRADLE_KOTLIN_REGEX = /(?:implementation|api|compile|runtimeOnly|testImplementation)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const MAVEN_DEP_REGEX = /<dependency>([\s\S]*?)<\/dependency>/g;
const MAVEN_GROUP_REGEX = /<groupId>(.*?)<\/groupId>/;
const MAVEN_ARTIFACT_REGEX = /<artifactId>(.*?)<\/artifactId>/;
const MAVEN_VERSION_REGEX = /<version>(.*?)<\/version>/;
const GO_SINGLE_REGEX = /^require\s+(\S+)\s+(\S+)/;
const GO_BLOCK_REGEX = /^(\S+)\s+(\S+)/;

// Helper function to safely slice off trailing .git cleanly
const stripTrailingGit = (str?: string): string => {
	if (!str) return '';
	return str.endsWith('.git') ? str.slice(0, -4) : str;
};

export const parseGithubUrl = (repoUrl: string) => {
	const url = new URL(repoUrl);
	const [, owner, repo] = url.pathname.split('/');
	return { owner, repo: stripTrailingGit(repo) };
};

export const parseGitlabUrl = (repoUrl: string) => {
	const url = new URL(repoUrl);
	const parts = url.pathname.split('/').filter(Boolean);
	return {
		owner: parts[0],
		repo: stripTrailingGit(parts[1]),
		fullPath: parts.join('/'),
	};
};

export const parseByEcosystem = (ecosystem: Ecosystem, content: string, fileName?: string): Record<string, string> => {
	switch (ecosystem) {
		case 'nodejs':
			return parsePackageJson(content);
		case 'python':
			return parseRequirementsTxt(content);
		case 'java':
			return fileName === 'build.gradle' ? parseBuildGradle(content) : parsePomXml(content);
		case 'go':
			return parseGoMod(content);
		default:
			return {};
	}
};

export const parsePackageJson = (content: string): Record<string, string> => {
	const json = JSON.parse(content);
	return {
		...json.dependencies,
		...json.devDependencies,
	};
};

export const parseRequirementsTxt = (content: string): Record<string, string> => {
	const deps: Record<string, string> = {};
	const lines = content.split('\n');

	for (let i = 0; i < lines.length; i++) {
		const trimmed = lines[i].trim();
		if (!trimmed || trimmed[0] === '#') continue; // Faster character lookup than startsWith

		const match = trimmed.match(PYTHON_LINE_REGEX);
		if (match) {
			deps[match[1]] = match[2] ? match[2].trim() : '*';
		}
	}

	return deps;
};

export const parseBuildGradle = (content: string): Record<string, string> => {
	const deps: Record<string, string> = {};
	let match;

	// Reset global regex indices
	GRADLE_SHORT_REGEX.lastIndex = 0;
	GRADLE_LONG_REGEX.lastIndex = 0;
	GRADLE_KOTLIN_REGEX.lastIndex = 0;

	while ((match = GRADLE_SHORT_REGEX.exec(content)) !== null) {
		const parts = match[1].split(':');
		if (parts.length >= 2) {
			deps[`${parts[0]}:${parts[1]}`] = parts[2] ?? 'unknown';
		}
	}

	while ((match = GRADLE_LONG_REGEX.exec(content)) !== null) {
		deps[`${match[1]}:${match[2]}`] = match[3];
	}

	while ((match = GRADLE_KOTLIN_REGEX.exec(content)) !== null) {
		const parts = match[1].split(':');
		if (parts.length >= 2) {
			deps[`${parts[0]}:${parts[1]}`] = parts[2] ?? 'unknown';
		}
	}

	return deps;
};

export const parsePomXml = (content: string): Record<string, string> => {
	const deps: Record<string, string> = {};
	let match;

	MAVEN_DEP_REGEX.lastIndex = 0;

	while ((match = MAVEN_DEP_REGEX.exec(content)) !== null) {
		const block = match[1];
		const groupId = block.match(MAVEN_GROUP_REGEX)?.[1];
		const artifactId = block.match(MAVEN_ARTIFACT_REGEX)?.[1];
		const version = block.match(MAVEN_VERSION_REGEX)?.[1] ?? 'unknown';

		if (groupId && artifactId) {
			deps[`${groupId}:${artifactId}`] = version;
		}
	}

	return deps;
};

export const parseGoMod = (content: string): Record<string, string> => {
	const deps: Record<string, string> = {};
	const lines = content.split('\n');
	let inRequire = false;

	for (let i = 0; i < lines.length; i++) {
		const trimmed = lines[i].trim();

		if (trimmed === 'require (') {
			inRequire = true;
			continue;
		}
		if (trimmed === ')' && inRequire) {
			inRequire = false;
			continue;
		}

		const singleMatch = trimmed.match(GO_SINGLE_REGEX);
		if (singleMatch) {
			deps[singleMatch[1]] = singleMatch[2];
			continue;
		}

		if (inRequire) {
			const blockMatch = trimmed.match(GO_BLOCK_REGEX);
			if (blockMatch && blockMatch[1][0] !== '/' && blockMatch[1][1] !== '/') {
				deps[blockMatch[1]] = blockMatch[2];
			}
		}
	}

	return deps;
};

export const formatDate = (date: Date): string => date.toISOString().split('T')[0];

// Helper to create base64url encoding
function base64UrlEncode(str: string): string {
	return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Full JWT signing using Web Crypto API (works in Cloudflare Workers)
async function createSignedJWT(credentials: any): Promise<string> {
	const { client_email, private_key, private_key_id, project_id } = credentials;

	const now = Math.floor(Date.now() / 1000);
	const expires = now + 3600; // 1 hour

	const header = {
		alg: 'RS256',
		typ: 'JWT',
		kid: private_key_id,
	};

	const payload = {
		iss: client_email,
		scope: 'https://www.googleapis.com/auth/cloud-platform',
		aud: 'https://oauth2.googleapis.com/token',
		exp: expires,
		iat: now,
	};

	const headerB64 = base64UrlEncode(JSON.stringify(header));
	const payloadB64 = base64UrlEncode(JSON.stringify(payload));
	const signatureInput = `${headerB64}.${payloadB64}`;

	// Import private key
	const pem = private_key
		.replace(/-----BEGIN PRIVATE KEY-----/, '')
		.replace(/-----END PRIVATE KEY-----/, '')
		.replace(/\n/g, '');

	const binaryDer = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));

	const key = await crypto.subtle.importKey('pkcs8', binaryDer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);

	const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signatureInput));

	const signatureB64 = base64UrlEncode(String.fromCharCode(...new Uint8Array(signature)));

	return `${signatureInput}.${signatureB64}`;
}

export async function getGoogleAccessToken(serviceAccountJson: string): Promise<string> {
	const credentials = typeof serviceAccountJson === 'string' ? JSON.parse(serviceAccountJson) : serviceAccountJson;

	const jwt = await createSignedJWT(credentials);

	const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
			assertion: jwt,
		}),
	});

	const tokenData = (await tokenRes.json()) as any;

	if (!tokenRes.ok) {
		throw new Error(`Token exchange failed: ${tokenData.error}`);
	}

	return tokenData.access_token;
}
