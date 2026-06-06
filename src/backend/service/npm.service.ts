import type { NpmDownloadStats, NpmPackageInfo } from '@/types';
import { formatDate } from '@backend/helper';
import logger from '../util/logger';

export const fetchNpmPackageInfo = async (packageName: string): Promise<NpmPackageInfo | null> => {
	try {
		const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}`, { headers: { Accept: 'application/json' } });

		if (!res.ok) return null;

		const data = (await res.json()) as any;

		const latestVersion = data['dist-tags']?.latest ?? 'unknown';
		const latestMeta = data.versions?.[latestVersion] ?? {};
		const time = data.time ?? {};

		const isDeprecated = !!latestMeta.deprecated || typeof latestMeta.deprecated === 'string';

		const lastPublishedAt = time.modified ?? time[latestVersion] ?? '';
		const lastPublishedDaysAgo = lastPublishedAt
			? Math.floor((Date.now() - new Date(lastPublishedAt).getTime()) / (1000 * 60 * 60 * 24))
			: 9999;

		const maintainerCount = data.maintainers?.length ?? 0;

		return {
			name: packageName,
			version: latestVersion,
			isDeprecated,
			deprecationMessage: typeof latestMeta.deprecated === 'string' ? latestMeta.deprecated : undefined,
			lastPublishedAt,
			lastPublishedDaysAgo,
			weeklyDownloads: 0,
			maintainerCount,
			license: latestMeta.license,
			homepage: latestMeta.homepage,
			repository: typeof latestMeta.repository === 'string' ? latestMeta.repository : latestMeta.repository?.url,
		};
	} catch (err) {
		logger.error('fetchNpmPackageInfo failed', err, { package: packageName });
		return null;
	}
};

export const fetchNpmDownloadStats = async (packageName: string): Promise<NpmDownloadStats> => {
	try {
		if (packageName.startsWith('@types/')) {
			return { weeklyDownloads: 0, monthlyDownloads: 0, trendPercent: 0 };
		}
		const encoded = packageName.startsWith('@') ? '@' + packageName.slice(1).replace('/', '%2F') : packageName;

		const threeMonthsAgo = new Date();
		threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
		const start = formatDate(threeMonthsAgo);
		const end = formatDate(new Date(threeMonthsAgo.getTime() + 7 * 24 * 60 * 60 * 1000));

		const [weekData, monthData, trendData] = (await Promise.all([
			fetch(`https://api.npmjs.org/downloads/point/last-week/${encoded}`).then((r) => r.json()),
			fetch(`https://api.npmjs.org/downloads/point/last-month/${encoded}`).then((r) => r.json()),
			fetch(`https://api.npmjs.org/downloads/point/${start}:${end}/${encoded}`).then((r) => r.json()),
		])) as any[];

		const weeklyDownloads = weekData.downloads ?? 0;
		const monthlyDownloads = monthData.downloads ?? 0;
		const oldWeeklyDownloads = trendData.downloads ?? weeklyDownloads;

		const trendPercent = oldWeeklyDownloads > 0 ? Math.round(((weeklyDownloads - oldWeeklyDownloads) / oldWeeklyDownloads) * 100) : 0;

		return { weeklyDownloads, monthlyDownloads, trendPercent };
	} catch (err) {
		logger.error('fetchNpmDownloadStats failed', err, { package: packageName });
		return { weeklyDownloads: 0, monthlyDownloads: 0, trendPercent: 0 };
	}
};

export const fetchGithubCommitActivity = async (
	packageName: string,
	token?: string,
): Promise<{ lastCommitDaysAgo: number; maintainerActive: boolean }> => {
	try {
		if (packageName.startsWith('@types/')) {
			return { lastCommitDaysAgo: 0, maintainerActive: true };
		}
		const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}`, { headers: { Accept: 'application/json' } });

		if (!res.ok) return { lastCommitDaysAgo: 365, maintainerActive: false };

		const data = (await res.json()) as any;
		const latestVersion = data['dist-tags']?.latest;
		const repoUrl = data.versions?.[latestVersion]?.repository?.url ?? data.repository?.url;

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
		logger.error('fetchGithubCommitActivity failed', err, { package: packageName });
		return { lastCommitDaysAgo: 365, maintainerActive: false };
	}
};
