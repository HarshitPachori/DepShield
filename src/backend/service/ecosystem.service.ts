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
		logger.error('GitHub file list fetch failed', undefined, { owner, repo, path, status: res.status, hasToken: !!token });
		throw new Error(`GitHub API error: ${res.status}`);
	}

	const files = (await res.json()) as Array<{ name: string }>;
	logger.info('GitHub file list fetched', { owner, repo, path: path || 'root', count: files.length });
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
		logger.error('GitLab file list fetch failed', undefined, { fullPath, path, status: res.status, hasToken: !!token });
		throw new Error(`GitLab API error: ${res.status}`);
	}
	const files = (await res.json()) as Array<{ name: string }>;
	logger.info('GitLab file list fetched', { fullPath, path: path || 'root', count: files.length });
	return files.map((f) => f.name);
};

const fetchFileList = (repoUrl: string, platform: 'github' | 'gitlab', path: string, token?: string): Promise<string[]> =>
	platform === 'github' ? fetchGithubFileList(repoUrl, path, token) : fetchGitlabFileList(repoUrl, path, token);

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
	logger.info('Detecting ecosystem', { repoUrl, platform, hasToken: !!token });

	const rootFiles = await fetchFileList(repoUrl, platform, '', token);
	logger.info('Root files fetched', { count: rootFiles.length, files: rootFiles });

	const rootMatch = matchEcosystem(rootFiles);
	if (rootMatch.ecosystem) {
		logger.info('Ecosystem detected at root', {
			ecosystem: rootMatch.ecosystem,
			packageManager: rootMatch.packageManager,
			dependencyFile: rootMatch.dependencyFile,
		});
		return { ...rootMatch, basePath: '', allDetected: [] };
	}

	logger.info('No ecosystem at root, checking subdirs');

	const matchingSubdirs = rootFiles.filter((f) => COMMON_SUBDIRS.some((subdir) => f.toLowerCase().includes(subdir.toLowerCase())));
	logger.info('Matching subdirs', { subdirs: matchingSubdirs });

	if (matchingSubdirs.length === 0) {
		logger.warn('No ecosystem detected and no matching subdirs', { repoUrl });
		return { ecosystem: null, packageManager: null, dependencyFile: null, lockFile: null, supported: false, basePath: '', allDetected: [] };
	}

	const subdirResults = await Promise.allSettled(
		matchingSubdirs.map(async (subdir) => {
			const files = await fetchFileList(repoUrl, platform, subdir, token);
			const match = matchEcosystem(files);
			if (match.ecosystem) {
				logger.info('Ecosystem detected in subdir', { subdir, ecosystem: match.ecosystem });
			}
			return match.ecosystem ? { ...match, basePath: subdir, files } : null;
		}),
	);

	const allDetected: Array<{ ecosystem: Ecosystem; supported: boolean; basePath: string }> = [];
	let primaryFiles: string[] | null = null;
	let primaryMatch: Omit<EcosystemDetection, 'basePath' | 'allDetected'> | null = null;

	for (const result of subdirResults) {
		if (result.status === 'rejected') {
			logger.warn('Subdir fetch failed', { reason: result.reason });
			continue;
		}
		if (result.value) {
			const { files, ...detection } = result.value;
			allDetected.push({ ecosystem: detection.ecosystem!, supported: detection.supported, basePath: detection.basePath });
			if (!primaryMatch && detection.supported) {
				primaryFiles = files;
				primaryMatch = detection;
			}
		}
	}

	if (allDetected.length === 0) {
		logger.warn('No ecosystem detected in any subdir', { repoUrl, checkedSubdirs: matchingSubdirs });
		return { ecosystem: null, packageManager: null, dependencyFile: null, lockFile: null, supported: false, basePath: '', allDetected: [] };
	}

	logger.info('All detected ecosystems', { allDetected });

	const primary = allDetected.find((d) => d.supported) ?? allDetected[0];

	if (!primaryMatch || !primaryFiles) {
		primaryFiles = await fetchFileList(repoUrl, platform, primary.basePath, token);
		primaryMatch = matchEcosystem(primaryFiles);
	}

	logger.info('Primary ecosystem selected', { ecosystem: primary.ecosystem, basePath: primary.basePath, supported: primary.supported });

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
	existingDetection?: EcosystemDetection,
): Promise<Record<string, string>> => {
	const { ecosystem, dependencyFile, basePath } = existingDetection ?? (await detectEcosystem(repoUrl, platform, token));

	if (!ecosystem || !dependencyFile) {
		logger.warn('parseDependencies called with no ecosystem or dependency file', { repoUrl, ecosystem, dependencyFile });
		return {};
	}

	const filePath = basePath ? `${basePath}/${dependencyFile}` : dependencyFile;
	logger.info('Fetching dependency file', { platform, filePath, ecosystem });

	let content: string;

	if (platform === 'github') {
		const { owner, repo } = parseGithubUrl(repoUrl);
		const headers: Record<string, string> = { 'User-Agent': 'DepShield/1.0' };
		if (token) headers['Authorization'] = `Bearer ${token}`;

		const [mainRes, masterRes] = await Promise.allSettled([
			fetch(`https://raw.githubusercontent.com/${owner}/${repo}/main/${filePath}`, { headers }),
			fetch(`https://raw.githubusercontent.com/${owner}/${repo}/master/${filePath}`, { headers }),
		]);

		logger.info('GitHub dependency file fetch results', {
			mainStatus: mainRes.status === 'fulfilled' ? mainRes.value.status : 'rejected',
			masterStatus: masterRes.status === 'fulfilled' ? masterRes.value.status : 'rejected',
			filePath,
		});

		const successRes =
			mainRes.status === 'fulfilled' && mainRes.value.ok
				? mainRes.value
				: masterRes.status === 'fulfilled' && masterRes.value.ok
					? masterRes.value
					: null;

		if (!successRes) {
			logger.error('Failed to fetch dependency file from GitHub', undefined, { owner, repo, filePath, hasToken: !!token });
			throw new Error(`Failed to fetch ${filePath}`);
		}
		content = await successRes.text();
	} else {
		const { fullPath } = parseGitlabUrl(repoUrl);
		const encodedPath = encodeURIComponent(fullPath);
		const encodedFile = encodeURIComponent(filePath);
		const headers: Record<string, string> = {};
		if (token) headers['PRIVATE-TOKEN'] = token;

		const [mainRes, masterRes] = await Promise.allSettled([
			fetch(`https://gitlab.com/api/v4/projects/${encodedPath}/repository/files/${encodedFile}/raw?ref=main`, { headers }),
			fetch(`https://gitlab.com/api/v4/projects/${encodedPath}/repository/files/${encodedFile}/raw?ref=master`, { headers }),
		]);

		logger.info('GitLab dependency file fetch results', {
			mainStatus: mainRes.status === 'fulfilled' ? mainRes.value.status : 'rejected',
			masterStatus: masterRes.status === 'fulfilled' ? masterRes.value.status : 'rejected',
			filePath,
		});

		const successRes =
			mainRes.status === 'fulfilled' && mainRes.value.ok
				? mainRes.value
				: masterRes.status === 'fulfilled' && masterRes.value.ok
					? masterRes.value
					: null;

		if (!successRes) {
			logger.error('Failed to fetch dependency file from GitLab', undefined, { fullPath, filePath, hasToken: !!token });
			throw new Error(`Failed to fetch ${filePath}`);
		}
		content = await successRes.text();
	}

	const deps = parseByEcosystem(ecosystem, content, dependencyFile);
	logger.info('Dependencies parsed', { ecosystem, dependencyFile, count: Object.keys(deps).length });
	return deps;
};
