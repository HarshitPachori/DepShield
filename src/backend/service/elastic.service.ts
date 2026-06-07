import type { PackageRisk } from '@/types';
import logger from '@backend/util/logger';

export const SIGNALS_INDEX = 'depshield-signals';
export const CACHE_INDEX = 'depshield-cache';

let indicesEnsured = false;

const elasticFetch = async (path: string, env: CloudflareEnv, body?: unknown, method?: string): Promise<any> => {
	const base = env.ELASTIC_URL ?? 'http://localhost:9200';
	const apiKey = env.ELASTIC_API_KEY;

	if (!apiKey) logger.warn('No Elastic API key configured');
	if (!env.ELASTIC_URL) logger.warn('No Elastic URL configured, using localhost');

	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (apiKey) headers['Authorization'] = `ApiKey ${apiKey}`;

	const res = await fetch(`${base}${path}`, {
		method: method ?? (body ? 'POST' : 'GET'),
		headers,
		body: body ? JSON.stringify(body) : undefined,
	});

	if (!res.ok && res.status !== 404) {
		logger.error('Elastic request failed', undefined, { status: res.status, path, method: method ?? (body ? 'POST' : 'GET') });
		throw new Error(`Elastic error ${res.status}`);
	}

	return res.json();
};

const elasticBulk = async (lines: string[], env: CloudflareEnv): Promise<void> => {
	const base = env.ELASTIC_URL ?? 'http://localhost:9200';
	const apiKey = env.ELASTIC_API_KEY;

	const headers: Record<string, string> = { 'Content-Type': 'application/x-ndjson' };
	if (apiKey) headers['Authorization'] = `ApiKey ${apiKey}`;

	const res = await fetch(`${base}/_bulk`, {
		method: 'POST',
		headers,
		body: lines.join('\n') + '\n',
	});

	if (!res.ok) {
		logger.error('Elastic bulk index failed', undefined, { status: res.status, lineCount: lines.length });
	} else {
		logger.info('Elastic bulk complete', { documents: lines.length / 2 });
	}
};

export const createIndices = async (env: CloudflareEnv): Promise<void> => {
	if (indicesEnsured) return;

	logger.info('Checking Elastic indices');

	const [signalsRes, cacheRes] = await Promise.all([
		fetch(`${env.ELASTIC_URL ?? 'http://localhost:9200'}/${SIGNALS_INDEX}`, {
			method: 'HEAD',
			headers: env.ELASTIC_API_KEY ? { Authorization: `ApiKey ${env.ELASTIC_API_KEY}` } : {},
		}),
		fetch(`${env.ELASTIC_URL ?? 'http://localhost:9200'}/${CACHE_INDEX}`, {
			method: 'HEAD',
			headers: env.ELASTIC_API_KEY ? { Authorization: `ApiKey ${env.ELASTIC_API_KEY}` } : {},
		}),
	]);

	logger.info('Elastic index check', {
		signalsExists: signalsRes.ok,
		cacheExists: cacheRes.ok,
		signalsStatus: signalsRes.status,
		cacheStatus: cacheRes.status,
	});

	await Promise.all([
		signalsRes.ok
			? Promise.resolve()
			: elasticFetch(
					`/${SIGNALS_INDEX}`,
					env,
					{
						mappings: {
							properties: {
								package_name: { type: 'keyword' },
								ecosystem: { type: 'keyword' },
								signal_type: { type: 'keyword' },
								signal_text: { type: 'text', analyzer: 'english' },
								source: { type: 'keyword' },
								date: { type: 'date' },
								sentiment_score: { type: 'float' },
								weekly_downloads: { type: 'long' },
								is_deprecated: { type: 'boolean' },
								alternatives: { type: 'keyword' },
							},
						},
					},
					'PUT',
				).then(() => logger.info(`Index ${SIGNALS_INDEX} created`)),

		cacheRes.ok
			? Promise.resolve()
			: elasticFetch(
					`/${CACHE_INDEX}`,
					env,
					{
						mappings: {
							properties: {
								package_name: { type: 'keyword' },
								ecosystem: { type: 'keyword' },
								version: { type: 'keyword' },
								risk_score: { type: 'integer' },
								risk_level: { type: 'keyword' },
								fix_strategy: { type: 'keyword' },
								cve_count: { type: 'integer' },
								cves_json: { type: 'text' },
								is_deprecated: { type: 'boolean' },
								last_commit_days_ago: { type: 'integer' },
								download_trend_percent: { type: 'integer' },
								maintainer_active: { type: 'boolean' },
								weekly_downloads: { type: 'long' },
								alternatives: { type: 'keyword' },
								explanation: { type: 'text' },
								cached_at: { type: 'date' },
								expires_at: { type: 'date' },
							},
						},
					},
					'PUT',
				).then(() => logger.info(`Index ${CACHE_INDEX} created`)),
	]);

	indicesEnsured = true;
	logger.info('Elastic indices ready');
};

export const indexScanResults = async (results: PackageRisk[], env: CloudflareEnv, ttlHours: number = 24): Promise<void> => {
	if (!results.length) {
		logger.warn('indexScanResults called with empty results');
		return;
	}

	logger.info('Indexing scan results to Elastic', { count: results.length, ttlHours });

	await createIndices(env);

	const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();
	const cachedAt = new Date().toISOString();

	const lines = results.flatMap((pkg) => [
		JSON.stringify({ index: { _index: CACHE_INDEX, _id: `${pkg.ecosystem}:${pkg.name}` } }),
		JSON.stringify({
			package_name: pkg.name,
			ecosystem: pkg.ecosystem,
			version: pkg.declaredVersion,
			risk_score: pkg.riskScore,
			risk_level: pkg.riskLevel,
			fix_strategy: pkg.fixStrategy,
			cve_count: pkg.cves.length,
			cves_json: JSON.stringify(pkg.cves),
			is_deprecated: pkg.signals.isDeprecated,
			last_commit_days_ago: pkg.signals.lastCommitDaysAgo,
			download_trend_percent: pkg.signals.downloadTrendPercent,
			maintainer_active: pkg.signals.maintainerActive,
			weekly_downloads: pkg.signals.weeklyDownloads,
			alternatives: pkg.alternative ? [pkg.alternative] : [],
			explanation: pkg.explanation,
			cached_at: cachedAt,
			expires_at: expiresAt,
		}),
	]);

	await elasticBulk(lines, env);
};

export const getCachedPackage = async (name: string, ecosystem: string, env: CloudflareEnv): Promise<PackageRisk | null> => {
	try {
		const docId = `${ecosystem}:${name}`;
		const data = await elasticFetch(`/${CACHE_INDEX}/_doc/${encodeURIComponent(docId)}`, env);

		if (data?.status === 404 || !data?._source) {
			logger.debug('Elastic cache miss', { package: name, ecosystem });
			return null;
		}

		const hit = data._source;

		if (hit.expires_at && new Date(hit.expires_at) < new Date()) {
			logger.info('Elastic cache expired', { package: name, ecosystem, expiredAt: hit.expires_at });
			return null;
		}

		logger.info('Elastic cache hit', { package: name, ecosystem, riskLevel: hit.risk_level });

		return {
			name: hit.package_name,
			declaredVersion: hit.version,
			ecosystem: hit.ecosystem,
			riskScore: hit.risk_score,
			riskLevel: hit.risk_level,
			fixStrategy: hit.fix_strategy,
			cves: JSON.parse(hit.cves_json ?? '[]'),
			alternative: hit.alternatives?.[0],
			explanation: hit.explanation,
			signals: {
				isDeprecated: hit.is_deprecated,
				lastCommitDaysAgo: hit.last_commit_days_ago,
				downloadTrendPercent: hit.download_trend_percent,
				maintainerActive: hit.maintainer_active,
				weeklyDownloads: hit.weekly_downloads,
				openCveCount: hit.cve_count,
				communitySignal: undefined,
			},
		} as PackageRisk;
	} catch (err) {
		logger.error('getCachedPackage failed', err instanceof Error ? err : undefined, { package: name, ecosystem });
		return null;
	}
};

export const searchPackageSignals = async (
	packageName: string,
	ecosystem: string = 'npm',
	env: CloudflareEnv,
): Promise<PackageSignal[]> => {
	try {
		const data = await elasticFetch(`/${SIGNALS_INDEX}/_search`, env, {
			query: {
				bool: {
					must: [{ term: { package_name: packageName } }, { term: { ecosystem } }],
				},
			},
			size: 10,
			sort: [{ date: { order: 'desc' } }],
		});
		return data?.hits?.hits?.map((h: any) => h._source).filter(Boolean) ?? [];
	} catch (err) {
		logger.error('searchPackageSignals failed', err instanceof Error ? err : undefined, { package: packageName });
		return [];
	}
};

export const searchAlternatives = async (packageName: string, ecosystem: string = 'npm', env: CloudflareEnv): Promise<string[]> => {
	try {
		const data = await elasticFetch(`/${SIGNALS_INDEX}/_search`, env, {
			query: {
				bool: {
					must: [{ term: { package_name: packageName } }, { term: { signal_type: 'alternative' } }],
				},
			},
			size: 5,
		});
		const alts = data?.hits?.hits?.map((h: any) => h._source?.alternatives ?? []).flat() ?? [];
		return [...new Set(alts)] as string[];
	} catch (err) {
		logger.error('searchAlternatives failed', err instanceof Error ? err : undefined, { package: packageName });
		return [];
	}
};

export const searchMigrationGuides = async (packageName: string, env: CloudflareEnv): Promise<string> => {
	try {
		const data = await elasticFetch(`/${SIGNALS_INDEX}/_search`, env, {
			query: {
				bool: {
					must: { term: { package_name: packageName } },
					should: [
						{ term: { signal_type: 'migration' } },
						{ term: { signal_type: 'community' } },
						{ match: { signal_text: `migrate from ${packageName}` } },
					],
					minimum_should_match: 1,
				},
			},
			size: 3,
		});
		return (
			data?.hits?.hits
				?.map((h: any) => h._source?.signal_text ?? '')
				.filter(Boolean)
				.join(' ') ?? ''
		);
	} catch (err) {
		logger.error('searchMigrationGuides failed', err instanceof Error ? err : undefined, { package: packageName });
		return '';
	}
};

export const indexPackageSignal = async (signal: PackageSignal, env: CloudflareEnv): Promise<void> => {
	await elasticFetch(`/${SIGNALS_INDEX}/_doc`, env, signal);
};

export const bulkIndexSignals = async (signals: PackageSignal[], env: CloudflareEnv): Promise<void> => {
	if (!signals.length) return;
	const lines = signals.flatMap((doc) => [JSON.stringify({ index: { _index: SIGNALS_INDEX } }), JSON.stringify(doc)]);
	await elasticBulk(lines, env);
};

export interface PackageSignal {
	package_name: string;
	ecosystem: string;
	signal_type: 'deprecation' | 'abandonment' | 'community' | 'alternative' | 'migration' | 'cve';
	signal_text: string;
	source: string;
	date: string;
	sentiment_score: number;
	weekly_downloads?: number;
	is_deprecated?: boolean;
	alternatives?: string[];
}
