import type { NpmDownloadStats, NpmPackageInfo } from '@/types';
import logger from '../util/logger';

const NPM_BULK_LIMIT = 128;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = (ms: number) => ms + Math.random() * 50 - 25;

const fetchWithBackoff = async (url: string, retries = 3): Promise<Response | null> => {
	for (let attempt = 0; attempt <= retries; attempt++) {
		const res = await fetch(url);
		if (res.ok) return res;
		if (res.status !== 429 || attempt === retries) {
			logger.warn('npm downloads fetch failed', { url, status: res.status, attempt });
			return null;
		}
		const delay = jitter(200 * Math.pow(2, attempt));
		logger.info('Rate limited, backing off', { attempt, delayMs: Math.round(delay) });
		await sleep(delay);
	}
	return null;
};

const fetchBulkDownloads = async (names: string[], period: 'last-week' | 'last-month'): Promise<Record<string, number>> => {
	const allResults: Record<string, number> = {};
	const scoped = names.filter((n) => n.startsWith('@'));
	const unscoped = names.filter((n) => !n.startsWith('@'));

	// unscoped — batch in chunks of NPM_BULK_LIMIT
	for (let i = 0; i < unscoped.length; i += NPM_BULK_LIMIT) {
		const chunk = unscoped.slice(i, i + NPM_BULK_LIMIT);
		const res = await fetchWithBackoff(`https://api.npmjs.org/downloads/point/${period}/${chunk.join(',')}`);
		if (!res) {
			for (const name of chunk) allResults[name] = 0;
		} else {
			const data = (await res.json()) as any;
			for (const name of chunk) {
				allResults[name] = chunk.length === 1 ? (data.downloads ?? 0) : (data[name]?.downloads ?? 0);
			}
		}
		if (i + NPM_BULK_LIMIT < unscoped.length) await sleep(jitter(200));
	}

	// scoped — must be individual requests, batch them concurrently in groups of 5
	for (let i = 0; i < scoped.length; i += 5) {
		const chunk = scoped.slice(i, i + 5);
		await Promise.all(
			chunk.map(async (name) => {
				const res = await fetchWithBackoff(`https://api.npmjs.org/downloads/point/${period}/${encodeURIComponent(name)}`);
				allResults[name] = res ? (((await res.json()) as any).downloads ?? 0) : 0;
			}),
		);
		if (i + 5 < scoped.length) await sleep(jitter(200));
	}

	return allResults;
};

export const fetchNpmPackageInfo = async (packageName: string, npmToken?: string): Promise<NpmPackageInfo | null> => {
	try {
		const headers: Record<string, string> = {};
		if (npmToken) headers['Authorization'] = `Bearer ${npmToken}`;
		const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}`, { headers });

		if (!res.ok) {
			logger.warn('npm package info fetch failed', { package: packageName, status: res.status });
			return null;
		}

		const data = (await res.json()) as any;

		const latestVersion = data['dist-tags']?.latest ?? 'unknown';
		const isDeprecated = !!data.deprecated;
		const deprecationMessage = typeof data.deprecated === 'string' ? data.deprecated : undefined;

		if (!data.repository) logger.warn('No repository URL in npm manifest', { package: packageName });

		const repository = typeof data.repository === 'string' ? data.repository : data.repository?.url;

		if (repository && !repository.includes('github.com')) {
			logger.warn('Repository is not GitHub', { package: packageName, repository });
		}

		return {
			name: packageName,
			version: latestVersion,
			isDeprecated,
			deprecationMessage,
			lastPublishedAt: '',
			lastPublishedDaysAgo: 0,
			weeklyDownloads: 0,
			maintainerCount: data.maintainers?.length ?? 0,
			license: undefined,
			homepage: undefined,
			repository,
		};
	} catch (err) {
		logger.error('fetchNpmPackageInfo failed', err, { package: packageName });
		return null;
	}
};

export const fetchNpmDownloadStatsBatch = async (packageNames: string[], env?: CloudflareEnv): Promise<Map<string, NpmDownloadStats>> => {
	const results = new Map<string, NpmDownloadStats>();
	const empty: NpmDownloadStats = { weeklyDownloads: 0, monthlyDownloads: 0, trendPercent: 0 };
	const filtered = packageNames.filter((n) => !n.startsWith('@types/'));

	for (const name of packageNames.filter((n) => n.startsWith('@types/'))) {
		results.set(name, empty);
	}

	if (!filtered.length) return results;

	const uncached: string[] = [];
	if (env) {
		await Promise.all(
			filtered.map(async (name) => {
				try {
					const cached = await env.KV.get(`npm-downloads:${name}`);
					if (cached) {
						logger.debug('npm downloads cache hit', { package: name });
						results.set(name, JSON.parse(cached));
					} else {
						uncached.push(name);
					}
				} catch {
					uncached.push(name);
				}
			}),
		);
	} else {
		uncached.push(...filtered);
	}

	if (!uncached.length) {
		logger.info('All npm downloads from cache', { count: filtered.length });
		return results;
	}

	logger.info('Fetching npm downloads batch', {
		uncached: uncached.length,
		cached: filtered.length - uncached.length,
		chunks: Math.ceil(uncached.length / NPM_BULK_LIMIT),
	});

	try {
		const [weekData, monthData] = await Promise.all([
			fetchBulkDownloads(uncached, 'last-week'),
			sleep(jitter(200)).then(() => fetchBulkDownloads(uncached, 'last-month')),
		]);

		for (const name of uncached) {
			const weekly = weekData[name] ?? 0;
			const monthly = monthData[name] ?? 0;

			const avgWeekly = monthly > 0 ? Math.round(monthly / 4.3) : weekly;
			const trendPercent = avgWeekly > 0 ? Math.round(((weekly - avgWeekly) / avgWeekly) * 100) : 0;

			const stats: NpmDownloadStats = { weeklyDownloads: weekly, monthlyDownloads: monthly, trendPercent };
			results.set(name, stats);

			if (env && (weekly > 0 || monthly > 0)) {
				env.KV.put(`npm-downloads:${name}`, JSON.stringify(stats), { expirationTtl: 23 * 60 * 60 }).catch(() => {});
			}
		}

		logger.info('npm downloads batch complete', {
			fetched: uncached.length,
			cached: filtered.length - uncached.length,
			chunks: Math.ceil(uncached.length / NPM_BULK_LIMIT),
			withData: uncached.filter((n) => (results.get(n)?.weeklyDownloads ?? 0) > 0).length,
		});
	} catch (err) {
		logger.error('fetchNpmDownloadStatsBatch failed', err);
		for (const name of uncached) results.set(name, empty);
	}

	for (const name of packageNames) {
		if (!results.has(name)) results.set(name, empty);
	}

	return results;
};

export const fetchNpmDownloadStats = async (packageName: string, env?: CloudflareEnv): Promise<NpmDownloadStats> => {
	const map = await fetchNpmDownloadStatsBatch([packageName], env);
	return map.get(packageName) ?? { weeklyDownloads: 0, monthlyDownloads: 0, trendPercent: 0 };
};

export const fetchGithubCommitActivity = async (
	packageName: string,
	token?: string,
	knownRepoUrl?: string,
	npmToken?: string,
): Promise<{ lastCommitDaysAgo: number; maintainerActive: boolean }> => {
	try {
		if (packageName.startsWith('@types/')) {
			return { lastCommitDaysAgo: 0, maintainerActive: true };
		}

		let repoUrl = knownRepoUrl;

		if (!repoUrl) {
			const headers: Record<string, string> = {};
			if (npmToken) headers['Authorization'] = `Bearer ${npmToken}`;
			const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}`, { headers });
			if (!res.ok) {
				logger.warn('npm fallback fetch failed in commitActivity', { package: packageName, status: res.status });
				return { lastCommitDaysAgo: 365, maintainerActive: false };
			}
			const data = (await res.json()) as any;
			repoUrl = typeof data.repository === 'string' ? data.repository : data.repository?.url;
			if (!repoUrl) logger.warn('No repository in npm fallback manifest', { package: packageName });
		}

		if (!repoUrl) {
			logger.warn('No repo URL found', { package: packageName, knownRepoUrl });
			return { lastCommitDaysAgo: 365, maintainerActive: false };
		}

		const githubMatch = repoUrl.match(/github\.com[/:]([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)/);
		if (!githubMatch) {
			logger.warn('Repo URL is not GitHub', { package: packageName, repoUrl });
			return { lastCommitDaysAgo: 365, maintainerActive: false };
		}

		const [, owner, repo] = githubMatch;
		const cleanRepo = repo && repo.endsWith('.git') ? repo.slice(0, -4) : repo;

		const headers: Record<string, string> = {
			Accept: 'application/vnd.github.v3+json',
			'User-Agent': 'DepShield/1.0',
		};
		if (token) headers['Authorization'] = `Bearer ${token}`;

		const commitRes = await fetch(`https://api.github.com/repos/${owner}/${cleanRepo}/commits?per_page=1`, { headers });
		if (!commitRes.ok) {
			logger.warn('GitHub commit fetch failed', {
				package: packageName,
				owner,
				repo: cleanRepo,
				status: commitRes.status,
				hasToken: !!token,
			});
			return { lastCommitDaysAgo: 365, maintainerActive: false };
		}

		const commits = (await commitRes.json()) as any[];
		if (!commits.length) {
			logger.warn('GitHub repo has no commits', { package: packageName, owner, repo: cleanRepo });
			return { lastCommitDaysAgo: 9999, maintainerActive: false };
		}

		const lastCommitDaysAgo = Math.floor((Date.now() - new Date(commits[0].commit.committer.date).getTime()) / (1000 * 60 * 60 * 24));

		logger.info('GitHub commit activity fetched', { package: packageName, lastCommitDaysAgo, maintainerActive: lastCommitDaysAgo < 90 });

		return { lastCommitDaysAgo, maintainerActive: lastCommitDaysAgo < 90 };
	} catch (err) {
		logger.error('fetchGithubCommitActivity failed', err, { package: packageName });
		return { lastCommitDaysAgo: 365, maintainerActive: false };
	}
};
