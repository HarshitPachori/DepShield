import type { NpmDownloadStats, NpmPackageInfo } from '@/types';
import logger from '../util/logger';

export const fetchPyPIJson = async (packageName: string): Promise<any | null> => {
	try {
		const res = await fetch(`https://pypi.org/pypi/${packageName}/json`);
		if (!res.ok) {
			logger.warn('PyPI JSON fetch failed', { package: packageName, status: res.status });
			return null;
		}
		return res.json();
	} catch (err) {
		logger.error('fetchPyPIJson threw', err, { package: packageName });
		return null;
	}
};

export const extractGithubRepo = (data: any): { owner: string; repo: string } | null => {
	const projectUrls = data.info?.project_urls ?? {};
	const repoUrl =
		projectUrls['Source'] ??
		projectUrls['Source Code'] ??
		projectUrls['Repository'] ??
		projectUrls['Homepage'] ??
		data.info?.home_page ??
		'';

	if (!repoUrl) return null;

	const match = repoUrl.match(/github\.com[/:]([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)/);
	if (!match) return null;

	const rawRepo = match[2];

	// Low-CPU, direct string adjustment bypassing RegEx compilation
	const cleanRepo = rawRepo && rawRepo.endsWith('.git') ? rawRepo.slice(0, -4) : rawRepo;

	return { owner: match[1], repo: cleanRepo };
};

export const fetchGithubLastCommit = async (
	owner: string,
	repo: string,
	token?: string,
): Promise<{ lastCommitDaysAgo: number; maintainerActive: boolean }> => {
	const headers: Record<string, string> = {
		Accept: 'application/vnd.github.v3+json',
		'User-Agent': 'DepShield/1.0',
	};
	if (token) headers['Authorization'] = `Bearer ${token}`;

	const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits?per_page=1`, { headers });
	if (!res.ok) {
		logger.warn('GitHub commit fetch failed', { owner, repo, status: res.status, hasToken: !!token });
		return { lastCommitDaysAgo: 365, maintainerActive: false };
	}

	const commits = (await res.json()) as any[];
	if (!commits.length) {
		logger.warn('GitHub repo has no commits', { owner, repo });
		return { lastCommitDaysAgo: 9999, maintainerActive: false };
	}

	const lastCommitDaysAgo = Math.floor((Date.now() - new Date(commits[0].commit.committer.date).getTime()) / (1000 * 60 * 60 * 24));

	logger.info('GitHub commit fetched', { owner, repo, lastCommitDaysAgo, maintainerActive: lastCommitDaysAgo < 90 });

	return { lastCommitDaysAgo, maintainerActive: lastCommitDaysAgo < 90 };
};

export const fetchPyPICommitActivity = async (
	packageName: string,
	token?: string,
	knownData?: any,
): Promise<{ lastCommitDaysAgo: number; maintainerActive: boolean }> => {
	try {
		const data = knownData ?? (await fetchPyPIJson(packageName));
		if (!data) {
			logger.warn('No PyPI data for commit activity', { package: packageName });
			return { lastCommitDaysAgo: 365, maintainerActive: false };
		}

		const githubRepo = extractGithubRepo(data);
		if (!githubRepo) {
			logger.warn('No GitHub repo in PyPI metadata', { package: packageName, homePage: data.info?.home_page });
			return { lastCommitDaysAgo: 365, maintainerActive: false };
		}

		return fetchGithubLastCommit(githubRepo.owner, githubRepo.repo, token);
	} catch (err) {
		logger.error('fetchPyPICommitActivity failed', err, { package: packageName });
		return { lastCommitDaysAgo: 365, maintainerActive: false };
	}
};

export const fetchPyPIDownloadStats = async (packageName: string): Promise<NpmDownloadStats> => {
	try {
		const res = await fetch(`https://pypistats.org/api/packages/${packageName.toLowerCase()}/recent`);
		if (!res.ok) {
			logger.warn('PyPI download stats fetch failed', { package: packageName, status: res.status });
			return { weeklyDownloads: 0, monthlyDownloads: 0, trendPercent: 0 };
		}

		const data = (await res.json()) as any;
		const weeklyDownloads = data.data?.last_week ?? 0;
		const monthlyDownloads = data.data?.last_month ?? 0;

		if (weeklyDownloads === 0) {
			logger.warn('PyPI weekly downloads zero', { package: packageName });
		}

		const avgWeekly = monthlyDownloads > 0 ? Math.round(monthlyDownloads / 4.3) : weeklyDownloads;
		const trendPercent = avgWeekly > 0 ? Math.round(((weeklyDownloads - avgWeekly) / avgWeekly) * 100) : 0;

		return { weeklyDownloads, monthlyDownloads, trendPercent };
	} catch (err) {
		logger.error('fetchPyPIDownloadStats failed', err, { package: packageName });
		return { weeklyDownloads: 0, monthlyDownloads: 0, trendPercent: 0 };
	}
};

export const fetchPyPIPackageInfo = async (packageName: string, knownData?: any): Promise<NpmPackageInfo | null> => {
	try {
		const data = knownData ?? (await fetchPyPIJson(packageName));
		if (!data) {
			logger.warn('No PyPI data for package info', { package: packageName });
			return null;
		}

		const info = data.info;
		const latestFiles = data.urls ?? [];
		const lastPublishedAt = latestFiles[0]?.upload_time ?? '';
		const lastPublishedDaysAgo = lastPublishedAt
			? Math.floor((Date.now() - new Date(lastPublishedAt).getTime()) / (1000 * 60 * 60 * 24))
			: 9999;

		const githubRepo = extractGithubRepo(data);

		if (!githubRepo) {
			logger.warn('No GitHub repo in PyPI package info', {
				package: packageName,
				homePage: info?.home_page,
				projectUrls: Object.keys(info?.project_urls ?? {}),
			});
		}

		logger.info('PyPI package info fetched', {
			package: packageName,
			version: info?.version,
			lastPublishedDaysAgo,
			hasGithubRepo: !!githubRepo,
			isDeprecated: info.classifiers?.some((c: string) => c.includes('Inactive') || c.includes('Abandoned')) ?? false,
		});

		return {
			name: packageName,
			version: info.version,
			isDeprecated: info.classifiers?.some((c: string) => c.includes('Inactive') || c.includes('Abandoned')) ?? false,
			deprecationMessage: undefined,
			lastPublishedAt,
			lastPublishedDaysAgo,
			weeklyDownloads: 0,
			maintainerCount: info.maintainer ? 1 : 0,
			license: info.license,
			homepage: info.home_page,
			repository: githubRepo ? `https://github.com/${githubRepo.owner}/${githubRepo.repo}` : undefined,
		};
	} catch (err) {
		logger.error('fetchPyPIPackageInfo failed', err, { package: packageName });
		return null;
	}
};
