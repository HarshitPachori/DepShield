import { NpmDownloadStats, NpmPackageInfo } from '@/types';
import logger from '../util/logger';

export const fetchPyPICommitActivity = async (
	packageName: string,
	token?: string,
): Promise<{ lastCommitDaysAgo: number; maintainerActive: boolean }> => {
	try {
		const res = await fetch(`https://pypi.org/pypi/${packageName}/json`);
		if (!res.ok) return { lastCommitDaysAgo: 365, maintainerActive: false };

		const data = (await res.json()) as any;
		const projectUrls = data.info?.project_urls ?? {};

		const repoUrl =
			projectUrls['Source'] ??
			projectUrls['Source Code'] ??
			projectUrls['Repository'] ??
			projectUrls['Homepage'] ??
			data.info?.home_page ??
			'';

		if (!repoUrl) return { lastCommitDaysAgo: 365, maintainerActive: false };

		const githubMatch = repoUrl.match(/github\.com[/:]([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)/);
		if (!githubMatch) return { lastCommitDaysAgo: 365, maintainerActive: false };

		const [, owner, repo] = githubMatch;
		const cleanRepo = repo.replace(/\.git$/, '');

		const headers: Record<string, string> = {
			Accept: 'application/vnd.github.v3+json',
			'User-Agent': 'DepShield/1.0',
		};
		if (token) headers['Authorization'] = `Bearer ${token}`;

		const commitRes = await fetch(`https://api.github.com/repos/${owner}/${cleanRepo}/commits?per_page=1`, { headers });
		if (!commitRes.ok) return { lastCommitDaysAgo: 365, maintainerActive: false };

		const commits = (await commitRes.json()) as any[];
		if (!commits.length) return { lastCommitDaysAgo: 9999, maintainerActive: false };

		const lastCommitDate = new Date(commits[0].commit.committer.date);
		const lastCommitDaysAgo = Math.floor((Date.now() - lastCommitDate.getTime()) / (1000 * 60 * 60 * 24));

		return {
			lastCommitDaysAgo,
			maintainerActive: lastCommitDaysAgo < 90,
		};
	} catch (err) {
		logger.error('fetchPyPICommitActivity failed', err, { package: packageName });
		return { lastCommitDaysAgo: 365, maintainerActive: false };
	}
};

export const fetchPyPIDownloadStats = async (packageName: string): Promise<NpmDownloadStats> => {
	try {
		const weekRes = await fetch(`https://pypistats.org/api/packages/${packageName.toLowerCase()}/recent`);
		if (!weekRes.ok) return { weeklyDownloads: 0, monthlyDownloads: 0, trendPercent: 0 };

		const weekData = (await weekRes.json()) as any;
		const weeklyDownloads = weekData.data?.last_week ?? 0;
		const monthlyDownloads = weekData.data?.last_month ?? 0;

		const overallRes = await fetch(`https://pypistats.org/api/packages/${packageName.toLowerCase()}/overall`);
		const overallData = (await overallRes.json()) as any;

		const entries = overallData.data ?? [];
		const recent = entries.slice(-2);
		const trendPercent =
			recent.length === 2 && recent[0].downloads > 0
				? Math.round(((recent[1].downloads - recent[0].downloads) / recent[0].downloads) * 100)
				: 0;

		return { weeklyDownloads, monthlyDownloads, trendPercent };
	} catch (err) {
		logger.error('fetchPyPIDownloadStats failed', err, { package: packageName });
		return { weeklyDownloads: 0, monthlyDownloads: 0, trendPercent: 0 };
	}
};

export const fetchPyPIPackageInfo = async (packageName: string): Promise<NpmPackageInfo | null> => {
	try {
		const res = await fetch(`https://pypi.org/pypi/${packageName}/json`);
		if (!res.ok) return null;

		const data = (await res.json()) as any;
		const info = data.info;

		const releases = data.releases ?? {};
		const allDates = Object.values(releases)
			.flat()
			.map((r: any) => r.upload_time)
			.filter(Boolean)
			.sort();

		const lastPublishedAt = allDates[allDates.length - 1] ?? '';
		const lastPublishedDaysAgo = lastPublishedAt
			? Math.floor((Date.now() - new Date(lastPublishedAt).getTime()) / (1000 * 60 * 60 * 24))
			: 9999;

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
			repository: info.project_urls?.Source,
		};
	} catch (err) {
		logger.error('fetchPyPIPackageInfo failed', err, { package: packageName });
		return null;
	}
};
