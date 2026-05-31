import type { Ecosystem, EcosystemDetection, PackageManager } from '@/types';

// ─── Constants ───────────────────────────────────────────────────────────────

const ECOSYSTEM_FILES: Array<{
	files: string[];
	ecosystem: Ecosystem;
	supported: boolean;
}> = [
	{ files: ['package.json'], ecosystem: 'nodejs', supported: true },
	{ files: ['requirements.txt', 'pyproject.toml'], ecosystem: 'python', supported: false },
	{ files: ['go.mod'], ecosystem: 'go', supported: false },
	{ files: ['pom.xml', 'build.gradle'], ecosystem: 'java', supported: false },
	{ files: ['Gemfile'], ecosystem: 'ruby', supported: false },
	{ files: ['composer.json'], ecosystem: 'php', supported: false },
	{ files: ['Cargo.toml'], ecosystem: 'rust', supported: false },
];

const PACKAGE_MANAGER_FILES: Array<{
	file: string;
	manager: PackageManager;
}> = [
	{ file: 'bun.lockb', manager: 'bun' },
	{ file: 'pnpm-lock.yaml', manager: 'pnpm' },
	{ file: 'yarn.lock', manager: 'yarn' },
	{ file: 'package-lock.json', manager: 'npm' },
];

const DEPENDENCY_FILES: Record<Ecosystem, string> = {
	nodejs: 'package.json',
	python: 'requirements.txt',
	go: 'go.mod',
	java: 'pom.xml',
	ruby: 'Gemfile',
	php: 'composer.json',
	rust: 'Cargo.toml',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const parseGithubUrl = (repoUrl: string) => {
	const url = new URL(repoUrl);
	const [, owner, repo] = url.pathname.split('/');
	return { owner, repo: repo?.replace('.git', '') };
};

const parseGitlabUrl = (repoUrl: string) => {
	const url = new URL(repoUrl);
	const parts = url.pathname.split('/').filter(Boolean);
	return {
		owner: parts[0],
		repo: parts[1]?.replace('.git', ''),
		fullPath: parts.join('/'),
	};
};

// ─── File Fetchers ────────────────────────────────────────────────────────────

const fetchGithubFileList = async (repoUrl: string, token?: string): Promise<string[]> => {
	const { owner, repo } = parseGithubUrl(repoUrl);

	const headers: Record<string, string> = {
		Accept: 'application/vnd.github.v3+json',
		'User-Agent': 'DepShield/1.0',
	};
	if (token) headers['Authorization'] = `Bearer ${token}`;

	const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/`, { headers });

	if (!res.ok) {
		throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
	}

	const files = (await res.json()) as Array<{ name: string; type: string }>;
	return files.map((f) => f.name);
};

const fetchGitlabFileList = async (repoUrl: string, token?: string): Promise<string[]> => {
	const { fullPath } = parseGitlabUrl(repoUrl);
	const encodedPath = encodeURIComponent(fullPath);

	const headers: Record<string, string> = {};
	if (token) headers['PRIVATE-TOKEN'] = token;

	const res = await fetch(`https://gitlab.com/api/v4/projects/${encodedPath}/repository/tree`, { headers });

	if (!res.ok) {
		throw new Error(`GitLab API error: ${res.status} ${res.statusText}`);
	}

	const files = (await res.json()) as Array<{ name: string; type: string }>;
	return files.map((f) => f.name);
};

// ─── Main Service ─────────────────────────────────────────────────────────────

export const detectEcosystem = async (repoUrl: string, platform: 'github' | 'gitlab', token?: string): Promise<EcosystemDetection> => {
	// Fetch root file list
	const files = platform === 'github' ? await fetchGithubFileList(repoUrl, token) : await fetchGitlabFileList(repoUrl, token);

	// Detect ecosystem
	let ecosystem: Ecosystem | null = null;
	let supported = false;

	for (const entry of ECOSYSTEM_FILES) {
		const matched = entry.files.some((f) => files.includes(f));
		if (matched) {
			ecosystem = entry.ecosystem;
			supported = entry.supported;
			break;
		}
	}

	// Detect package manager (nodejs only)
	let packageManager: PackageManager | null = null;
	if (ecosystem === 'nodejs') {
		for (const entry of PACKAGE_MANAGER_FILES) {
			if (files.includes(entry.file)) {
				packageManager = entry.manager;
				break;
			}
		}
		// Default to npm if no lock file found
		if (!packageManager) packageManager = 'npm';
	}

	// Detect dependency + lock files
	const dependencyFile = ecosystem ? DEPENDENCY_FILES[ecosystem] : null;
	const lockFile = PACKAGE_MANAGER_FILES.find((p) => files.includes(p.file))?.file ?? null;

	return {
		ecosystem,
		packageManager,
		dependencyFile,
		lockFile,
		supported,
	};
};

// ─── Parse Dependencies ───────────────────────────────────────────────────────

export const parseDependencies = async (
	repoUrl: string,
	platform: 'github' | 'gitlab',
	token?: string,
): Promise<Record<string, string>> => {
	const { ecosystem, dependencyFile } = await detectEcosystem(repoUrl, platform, token);

	if (!ecosystem || !dependencyFile) return {};

	// Fetch the dependency file content
	let content: string;

	if (platform === 'github') {
		const { owner, repo } = parseGithubUrl(repoUrl);
		const headers: Record<string, string> = {
			'User-Agent': 'DepShield/1.0',
		};
		if (token) headers['Authorization'] = `Bearer ${token}`;

		const res = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/main/${dependencyFile}`, { headers });
		if (!res.ok) throw new Error(`Failed to fetch ${dependencyFile}`);
		content = await res.text();
	} else {
		const { fullPath } = parseGitlabUrl(repoUrl);
		const encodedPath = encodeURIComponent(fullPath);
		const headers: Record<string, string> = {};
		if (token) headers['PRIVATE-TOKEN'] = token;

		const res = await fetch(`https://gitlab.com/api/v4/projects/${encodedPath}/repository/files/${dependencyFile}/raw?ref=main`, {
			headers,
		});
		if (!res.ok) throw new Error(`Failed to fetch ${dependencyFile}`);
		content = await res.text();
	}

	// Parse based on ecosystem
	return parseByEcosystem(ecosystem, content);
};

const parseByEcosystem = (ecosystem: Ecosystem, content: string): Record<string, string> => {
	switch (ecosystem) {
		case 'nodejs':
			return parsePackageJson(content);
		case 'python':
			return parseRequirementsTxt(content);
		default:
			return {};
	}
};

const parsePackageJson = (content: string): Record<string, string> => {
	const json = JSON.parse(content);
	return {
		...json.dependencies,
		...json.devDependencies,
	};
};

const parseRequirementsTxt = (content: string): Record<string, string> => {
	const deps: Record<string, string> = {};
	const lines = content.split('\n');

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;

		// Handle: requests==2.27.0 or requests>=2.0 or requests
		const match = trimmed.match(/^([a-zA-Z0-9_-]+)([>=<!]=?.*)?$/);
		if (match) {
			deps[match[1]] = match[2]?.trim() ?? '*';
		}
	}

	return deps;
};
