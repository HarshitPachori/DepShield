import type { Ecosystem, EcosystemDetection, PackageManager } from '@/types';
import { parseByEcosystem, parseGithubUrl, parseGitlabUrl } from '@backend/helper';
import { COMMON_SUBDIRS, ECOSYSTEM_FILES, PACKAGE_MANAGER_FILES } from '@/backend/constants';
import logger from '@backend/util/logger';

const fetchGithubFileList = async (repoUrl: string, path: string = '', token?: string): Promise<string[]> => {
	const { owner, repo } = parseGithubUrl(repoUrl);

	const headers: Record<string, string> = {
		Accept: 'application/vnd.github.v3+json',
		'User-Agent': 'DepShield/1.0',
	};
	if (token) headers['Authorization'] = `Bearer ${token}`;

	const apiPath = path ? `/contents/${path}` : '/contents/';
	const res = await fetch(`https://api.github.com/repos/${owner}/${repo}${apiPath}`, { headers });

	if (!res.ok) {
		logger.error(`GitHub API error: ${res.status} - ${await res.text()}`);
		throw new Error(`GitHub API error: ${res.status}`);
	}

	const files = (await res.json()) as Array<{ name: string }>;
	return files.map((f) => f.name);
};

const fetchGitlabFileList = async (repoUrl: string, path: string = '', token?: string): Promise<string[]> => {
	const { fullPath } = parseGitlabUrl(repoUrl);
	const encodedPath = encodeURIComponent(fullPath);

	const headers: Record<string, string> = {};
	if (token) headers['PRIVATE-TOKEN'] = token;

	const pathParam = path ? `&path=${encodeURIComponent(path)}` : '';
	const res = await fetch(`https://gitlab.com/api/v4/projects/${encodedPath}/repository/tree?ref=main${pathParam}`, { headers });
	if (!res.ok) {
		logger.error(`GitLab API error: ${res.status} - ${await res.text()}`);
		throw new Error(`GitLab API error: ${res.status}`);
	}
	const files = (await res.json()) as Array<{ name: string }>;
	return files.map((f) => f.name);
};

const matchEcosystem = (files: string[]): Omit<EcosystemDetection, 'basePath' | 'allDetected'> => {
	let ecosystem: Ecosystem | null = null;
	let supported = false;
	let dependencyFile: string | null = null;

	for (const entry of ECOSYSTEM_FILES) {
		const matchedFile = entry.files.find((f) => files.includes(f));
		if (matchedFile) {
			ecosystem = entry.ecosystem;
			supported = entry.supported;
			dependencyFile = matchedFile;
			break;
		}
	}

	let packageManager: PackageManager | null = null;
	if (ecosystem === 'nodejs') {
		for (const entry of PACKAGE_MANAGER_FILES) {
			if (files.includes(entry.file)) {
				packageManager = entry.manager;
				break;
			}
		}
		if (!packageManager) packageManager = 'npm';
	}

	const lockFile = PACKAGE_MANAGER_FILES.find((p) => files.includes(p.file))?.file ?? null;

	return { ecosystem, packageManager, dependencyFile, lockFile, supported };
};

export const detectEcosystem = async (repoUrl: string, platform: 'github' | 'gitlab', token?: string): Promise<EcosystemDetection> => {
	const rootFiles = platform === 'github' ? await fetchGithubFileList(repoUrl, '', token) : await fetchGitlabFileList(repoUrl, '', token);

	const rootMatch = matchEcosystem(rootFiles);
	if (rootMatch.ecosystem) return { ...rootMatch, basePath: '', allDetected: [] };

	const matchingSubdirs = rootFiles.filter((f: string) => COMMON_SUBDIRS.some((subdir) => f.toLowerCase().includes(subdir.toLowerCase())));

	const allDetected: Array<{ ecosystem: Ecosystem; supported: boolean; basePath: string }> = [];

	for (const subdir of matchingSubdirs) {
		try {
			const subdirFiles =
				platform === 'github' ? await fetchGithubFileList(repoUrl, subdir, token) : await fetchGitlabFileList(repoUrl, subdir, token);

			const match = matchEcosystem(subdirFiles);
			if (match.ecosystem) {
				allDetected.push({
					ecosystem: match.ecosystem,
					supported: match.supported,
					basePath: subdir,
				});
			}
		} catch {
			continue;
		}
	}

	if (allDetected.length === 0) {
		return { ecosystem: null, packageManager: null, dependencyFile: null, lockFile: null, supported: false, basePath: '', allDetected: [] };
	}

	const primary = allDetected.find((d) => d.supported) ?? allDetected[0];

	const primaryFiles =
		platform === 'github'
			? await fetchGithubFileList(repoUrl, primary.basePath, token)
			: await fetchGitlabFileList(repoUrl, primary.basePath, token);

	const primaryMatch = matchEcosystem(primaryFiles);

	return {
		...primaryMatch,
		basePath: primary.basePath,
		allDetected,
	};
};

export const detectPlatform = (repoUrl: string): 'github' | 'gitlab' | null => {
	if (repoUrl.includes('github.com')) return 'github';
	if (repoUrl.includes('gitlab.com')) return 'gitlab';
	return null;
};

export const parseDependencies = async (
	repoUrl: string,
	platform: 'github' | 'gitlab',
	token?: string,
): Promise<Record<string, string>> => {
	const { ecosystem, dependencyFile, basePath } = await detectEcosystem(repoUrl, platform, token);

	if (!ecosystem || !dependencyFile) return {};

	const filePath = basePath ? `${basePath}/${dependencyFile}` : dependencyFile;

	let content: string;

	if (platform === 'github') {
		const { owner, repo } = parseGithubUrl(repoUrl);
		const headers: Record<string, string> = {
			'User-Agent': 'DepShield/1.0',
		};
		if (token) headers['Authorization'] = `Bearer ${token}`;

		let res = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/main/${filePath}`, { headers });

		if (!res.ok) {
			res = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/master/${filePath}`, { headers });
		}

		if (!res.ok) {
			logger.error(`Failed to fetch ${filePath} from GitHub: ${res.status} - ${await res.text()}`);
			throw new Error(`Failed to fetch ${filePath}`);
		}
		content = await res.text();
	} else {
		const { fullPath } = parseGitlabUrl(repoUrl);
		const encodedPath = encodeURIComponent(fullPath);
		const encodedFile = encodeURIComponent(filePath);
		const headers: Record<string, string> = {};
		if (token) headers['PRIVATE-TOKEN'] = token;

		let res = await fetch(`https://gitlab.com/api/v4/projects/${encodedPath}/repository/files/${encodedFile}/raw?ref=main`, { headers });

		if (!res.ok) {
			res = await fetch(`https://gitlab.com/api/v4/projects/${encodedPath}/repository/files/${encodedFile}/raw?ref=master`, { headers });
		}

		if (!res.ok) {
			logger.error(`Failed to fetch ${filePath} from GitLab: ${res.status} - ${await res.text()}`);
			throw new Error(`Failed to fetch ${filePath}`);
		}
		content = await res.text();
	}

	return parseByEcosystem(ecosystem, content, dependencyFile);
};
