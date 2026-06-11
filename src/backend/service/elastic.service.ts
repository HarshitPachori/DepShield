import type { PackageRisk } from '@/types';
import logger from '@backend/util/logger';

export const SIGNALS_INDEX = 'depshield-signals';
export const CACHE_INDEX = 'depshield-cache';
const REPO_SCANS_INDEX = 'depshield-repo-scans';

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

	const [signalsRes, cacheRes, repoScanRes] = await Promise.all([
		fetch(`${env.ELASTIC_URL ?? 'http://localhost:9200'}/${SIGNALS_INDEX}`, {
			method: 'HEAD',
			headers: env.ELASTIC_API_KEY ? { Authorization: `ApiKey ${env.ELASTIC_API_KEY}` } : {},
		}),
		fetch(`${env.ELASTIC_URL ?? 'http://localhost:9200'}/${CACHE_INDEX}`, {
			method: 'HEAD',
			headers: env.ELASTIC_API_KEY ? { Authorization: `ApiKey ${env.ELASTIC_API_KEY}` } : {},
		}),
		fetch(`${env.ELASTIC_URL ?? 'http://localhost:9200'}/${REPO_SCANS_INDEX}`, {
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

		repoScanRes.ok
			? Promise.resolve()
			: elasticFetch(
					`/${REPO_SCANS_INDEX}`,
					env,
					{
						mappings: {
							properties: {
								job_id: { type: 'keyword' },
								repo_url: { type: 'keyword' },
								ecosystem: { type: 'keyword' },
								scanned_at: { type: 'date' },
								total_packages: { type: 'integer' },
								critical_count: { type: 'integer' },
								high_count: { type: 'integer' },
								avg_risk_score: { type: 'float' },
								deprecated_count: { type: 'integer' },
								packages_with_cves: { type: 'integer' },
								top_risky_packages: {
									type: 'nested',
									properties: {
										name: { type: 'keyword' },
										risk_score: { type: 'integer' },
										risk_level: { type: 'keyword' },
										alternative: { type: 'keyword' },
									},
								},
							},
						},
					},
					'PUT',
				).then(() => logger.info(`Index ${REPO_SCANS_INDEX} created`)),
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
		JSON.stringify({ index: { _index: CACHE_INDEX, _id: `${pkg.ecosystem}:${pkg.name}:${pkg.declaredVersion}` } }),
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

	// Index dynamic signals for packages with alternative recommendations or explanations
	const signalPackages = results.filter((pkg) => pkg.alternative || pkg.explanation);
	if (signalPackages.length > 0) {
		logger.info('Indexing dynamic signals to Elastic', { count: signalPackages.length });
		const signals: PackageSignal[] = signalPackages.map((pkg) => ({
			package_name: pkg.name,
			ecosystem: pkg.ecosystem,
			signal_type: pkg.signals.isDeprecated ? 'deprecation' : 'migration',
			signal_text: pkg.explanation || `Migrate from ${pkg.name} to ${pkg.alternative}.`,
			source: 'gemini-enrichment',
			date: cachedAt,
			sentiment_score: pkg.riskLevel === 'CRITICAL' ? -0.9 : pkg.riskLevel === 'HIGH' ? -0.7 : -0.4,
			weekly_downloads: pkg.signals.weeklyDownloads,
			is_deprecated: pkg.signals.isDeprecated,
			alternatives: pkg.alternative ? [pkg.alternative] : [],
		}));

		const signalLines = signals.flatMap((doc) => [JSON.stringify({ index: { _index: SIGNALS_INDEX } }), JSON.stringify(doc)]);
		await elasticBulk(signalLines, env);
	}
};

export const getCachedPackage = async (
	name: string,
	ecosystem: string,
	env: CloudflareEnv,
	declaredVersion?: string,
): Promise<PackageRisk | null> => {
	try {
		const docId = declaredVersion ? `${ecosystem}:${name}:${declaredVersion}` : `${ecosystem}:${name}`;
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

export const queryMigrationSignals = async (packageName: string, env: CloudflareEnv): Promise<any> => {
	try {
		const data = await elasticFetch(`/${SIGNALS_INDEX}/_search`, env, {
			query: {
				bool: {
					must: [{ term: { package_name: packageName } }, { term: { signal_type: 'migration' } }],
				},
			},
			size: 10,
			sort: [{ date: { order: 'desc' } }],
		});

		const signals = data?.hits?.hits?.map((h: any) => h._source) ?? [];
		const alternatives = [...new Set(signals.flatMap((s: any) => s.alternatives ?? []))];

		return {
			package: packageName,
			migration_patterns: signals.map((s: any) => s.signal_text),
			alternatives,
			migration_count: signals.length,
			confidence: signals.length > 0 ? Math.min(0.95, 0.5 + signals.length * 0.1) : 0.3,
		};
	} catch (err) {
		logger.error('queryMigrationSignals failed', err, { package: packageName });
		return { package: packageName, alternatives: [], confidence: 0 };
	}
};

export const queryPackageTrends = async (packageName: string, env: CloudflareEnv): Promise<any> => {
	try {
		const data = await elasticFetch(`/${CACHE_INDEX}/_search`, env, {
			query: {
				term: { package_name: packageName },
			},
			aggs: {
				trend_over_time: {
					date_histogram: {
						field: 'cached_at',
						calendar_interval: 'week',
					},
					stats: {
						field: 'weekly_downloads',
					},
					avg_risk: {
						avg: { field: 'risk_score' },
					},
				},
			},
			size: 0,
		});

		const buckets = data?.aggregations?.trend_over_time?.buckets ?? [];
		const latestBucket = buckets[buckets.length - 1];
		const oldestBucket = buckets[0];

		const latestDownloads = latestBucket?.stats?.value ?? 0;
		const oldestDownloads = oldestBucket?.stats?.value ?? latestDownloads;
		const trendPercent = oldestDownloads > 0 ? Math.round(((latestDownloads - oldestDownloads) / oldestDownloads) * 100) : 0;

		return {
			package: packageName,
			download_trend_percent: trendPercent,
			latest_weekly_downloads: latestDownloads,
			avg_risk_score: latestBucket?.avg_risk?.value ?? 0,
			data_points: buckets.length,
			is_declining: trendPercent < -20,
			message:
				trendPercent < -50
					? `Downloads declining ${Math.abs(trendPercent)}% - package likely abandoned`
					: trendPercent < -20
						? `Downloads declining ${Math.abs(trendPercent)}% - package losing traction`
						: trendPercent > 0
							? `Downloads stable/growing`
							: `No trend data`,
		};
	} catch (err) {
		logger.error('queryPackageTrends failed', err, { package: packageName });
		return { package: packageName, download_trend_percent: 0, is_declining: false };
	}
};

export const queryCriticalPackages = async (env: CloudflareEnv): Promise<any[]> => {
	try {
		const data = await elasticFetch(`/${CACHE_INDEX}/_search`, env, {
			query: {
				bool: {
					must: [{ term: { risk_level: 'CRITICAL' } }, { range: { last_commit_days_ago: { gte: 180 } } }],
				},
			},
			size: 50,
			sort: [{ risk_score: { order: 'desc' } }],
		});

		return (
			data?.hits?.hits?.map((h: any) => ({
				name: h._source.package_name,
				risk_level: h._source.risk_level,
				risk_score: h._source.risk_score,
				last_commit_days_ago: h._source.last_commit_days_ago,
				is_deprecated: h._source.is_deprecated,
				alternatives: h._source.alternatives,
				explanation: h._source.explanation,
			})) ?? []
		);
	} catch (err) {
		logger.error('queryCriticalPackages failed', err);
		return [];
	}
};

export const searchCommunitySignals = async (packageName: string, env: CloudflareEnv): Promise<string> => {
	try {
		const data = await elasticFetch(`/${SIGNALS_INDEX}/_search`, env, {
			query: {
				bool: {
					must: [{ term: { package_name: packageName } }],
					should: [
						{ term: { signal_type: 'community' } },
						{ term: { signal_type: 'deprecation' } },
						{ term: { signal_type: 'abandonment' } },
					],
					minimum_should_match: 1,
				},
			},
			size: 5,
			sort: [{ date: { order: 'desc' } }],
		});

		const signals = data?.hits?.hits?.map((h: any) => h._source?.signal_text).filter(Boolean) ?? [];
		return signals.join('. ');
	} catch (err) {
		logger.error('searchCommunitySignals failed', err, { package: packageName });
		return '';
	}
};

export const queryDeprecationStatus = async (packageName: string, env: CloudflareEnv): Promise<any> => {
	try {
		const data = await elasticFetch(`/${CACHE_INDEX}/_search`, env, {
			query: {
				term: { package_name: packageName },
			},
			size: 1,
			sort: [{ cached_at: { order: 'desc' } }],
		});

		const pkg = data?.hits?.hits?.[0]?._source;
		if (!pkg) return { package: packageName, is_deprecated: false };

		return {
			package: packageName,
			is_deprecated: pkg.is_deprecated,
			risk_level: pkg.risk_level,
			cve_count: pkg.cve_count,
			last_updated: pkg.cached_at,
			alternatives: pkg.alternatives,
		};
	} catch (err) {
		logger.error('queryDeprecationStatus failed', err, { package: packageName });
		return { package: packageName, is_deprecated: false };
	}
};

export const computePackageHealthScore = async (packageName: string, env: CloudflareEnv): Promise<any> => {
	try {
		const data = await elasticFetch(`/${CACHE_INDEX}/_search`, env, {
			query: { term: { package_name: packageName } },
			aggs: {
				avg_risk: { avg: { field: 'risk_score' } },
				cve_stats: { stats: { field: 'cve_count' } },
				deprecation_count: { filter: { term: { is_deprecated: true } } },
				trend: {
					date_histogram: {
						field: 'cached_at',
						calendar_interval: 'week',
					},
					aggs: {
						weekly_stats: { stats: { field: 'weekly_downloads' } },
					},
				},
			},
			size: 0,
		});

		const avgRisk = data.aggregations?.avg_risk?.value ?? 50;
		const buckets = data.aggregations?.trend?.buckets ?? [];
		const latestDownloads = buckets[buckets.length - 1]?.weekly_stats?.avg ?? 0;
		const oldestDownloads = buckets[0]?.weekly_stats?.avg ?? latestDownloads;
		const downloadTrend = oldestDownloads > 0 ? Math.round(((latestDownloads - oldestDownloads) / oldestDownloads) * 100) : 0;
		const cveAvg = data.aggregations?.cve_stats?.avg ?? 0;
		const isDeprecated = (data.aggregations?.deprecation_count?.doc_count ?? 0) > 0;

		let healthScore = 100 - avgRisk - Math.abs(Math.min(downloadTrend, 0)) / 2 - (isDeprecated ? 25 : 0) - cveAvg * 2;
		healthScore = Math.max(0, Math.min(100, healthScore));

		return {
			package: packageName,
			health_score: Math.round(healthScore),
			avg_risk_score: Math.round(avgRisk * 10) / 10,
			download_trend_percent: downloadTrend,
			is_deprecated: isDeprecated,
			status: healthScore > 75 ? 'HEALTHY' : healthScore > 50 ? 'CAUTION' : healthScore > 25 ? 'RISKY' : 'CRITICAL',
			recommendation: healthScore < 40 ? 'Consider migration' : healthScore < 60 ? 'Monitor closely' : 'Package is stable',
		};
	} catch (err) {
		logger.error('computePackageHealthScore failed', err, { package: packageName });
		return { package: packageName, health_score: 0, status: 'UNKNOWN' };
	}
};

export const getMigrationIntelligence = async (env: CloudflareEnv): Promise<any> => {
	try {
		const data = await elasticFetch(`/${CACHE_INDEX}/_search`, env, {
			aggs: {
				packages_with_alternatives: {
					filter: {
						exists: { field: 'alternatives' },
					},
					aggs: {
						by_alternative: {
							terms: {
								field: 'alternatives',
								size: 10,
							},
							aggs: {
								source_packages: {
									terms: {
										field: 'package_name',
										size: 5,
									},
								},
								risky_migrations: {
									filter: {
										range: { risk_score: { gte: 70 } },
									},
									aggs: {
										count: { value_count: { field: 'package_name' } },
									},
								},
								avg_health_improvement: {
									avg: { field: 'risk_score' },
								},
							},
						},
					},
				},
			},
			size: 0,
		});

		const alternatives = data.aggregations.packages_with_alternatives.by_alternative.buckets
			.map((alt: any) => ({
				target: alt.key,
				total_migrations: alt.doc_count,
				source_packages: alt.source_packages.buckets.map((p: any) => p.key),
				risky_packages_migrated: alt.risky_migrations.count.value,
				avg_source_risk: Math.round(alt.avg_health_improvement.value * 10) / 10,
			}))
			.sort((a: any, b: any) => b.total_migrations - a.total_migrations);

		return {
			total_alternatives_detected: alternatives.length,
			top_migrations: alternatives.slice(0, 5),
			most_popular_target: alternatives[0]?.target || 'N/A',
			total_packages_with_migration_path: data.aggregations.packages_with_alternatives.doc_count,
			message: `Community most migrates to: ${alternatives[0]?.target || 'N/A'} (${alternatives[0]?.total_migrations || 0} migrations detected)`,
		};
	} catch (err) {
		logger.error('getMigrationIntelligence failed', err);
		return { top_migrations: [], message: 'No migration data available' };
	}
};

export const indexRepoScan = async (
	jobId: string,
	repoUrl: string,
	ecosystem: string,
	results: PackageRisk[],
	env: CloudflareEnv,
): Promise<void> => {
	const doc = {
		job_id: jobId,
		repo_url: repoUrl,
		ecosystem,
		scanned_at: new Date().toISOString(),
		total_packages: results.length,
		critical_count: results.filter((r) => r.riskLevel === 'CRITICAL').length,
		high_count: results.filter((r) => r.riskLevel === 'HIGH').length,
		medium_count: results.filter((r) => r.riskLevel === 'MEDIUM').length,
		low_count: results.filter((r) => r.riskLevel === 'LOW').length,
		safe_count: results.filter((r) => r.riskLevel === 'SAFE').length,
		avg_risk_score: results.reduce((s, r) => s + r.riskScore, 0) / results.length,
		top_risky_packages: results
			.filter((r) => r.riskLevel === 'CRITICAL' || r.riskLevel === 'HIGH')
			.slice(0, 10)
			.map((r) => ({
				name: r.name,
				risk_score: r.riskScore,
				risk_level: r.riskLevel,
				alternative: r.alternative,
			})),
		packages_with_cves: results.filter((r) => r.cves.length > 0).length,
		deprecated_count: results.filter((r) => r.signals.isDeprecated).length,
	};

	await elasticFetch(`/depshield-repo-scans/_doc/${jobId}`, env, doc, 'PUT');
	logger.info('Repo scan indexed', { jobId, repoUrl });
};

export const getGlobalRiskLeaderboard = async (env: CloudflareEnv): Promise<any> => {
	try {
		await createIndices(env);
		const data = await elasticFetch(`/${REPO_SCANS_INDEX}/_search`, env, {
			size: 0,
			aggs: {
				nested_packages: {
					nested: { path: 'top_risky_packages' },
					aggs: {
						by_name: {
							terms: {
								field: 'top_risky_packages.name',
								size: 20,
							},
							aggs: {
								avg_risk: { avg: { field: 'top_risky_packages.risk_score' } },
								top_level: {
									reverse_nested: {},
									aggs: {
										repo_count: { cardinality: { field: 'repo_url' } },
									},
								},
							},
						},
					},
				},
			},
		});

		return (
			data?.aggregations?.nested_packages?.by_name?.buckets?.map((b: any) => ({
				package: b.key,
				appearances: b.doc_count,
				avg_risk_score: Math.round(b.avg_risk?.value ?? 0),
				affected_repos: b.top_level?.repo_count?.value ?? 0,
			})) ?? []
		);
	} catch (err) {
		logger.error('getGlobalRiskLeaderboard failed', err);
		return [];
	}
};

export const searchScans = async (query: string, filters: { ecosystem?: string; minRisk?: string }, env: CloudflareEnv): Promise<any[]> => {
	try {
		const must: any[] = [
			{
				multi_match: {
					query,
					fields: ['repo_url', 'top_risky_packages.name', 'ecosystem'],
				},
			},
		];

		if (filters.ecosystem) must.push({ term: { ecosystem: filters.ecosystem } });
		if (filters.minRisk) must.push({ range: { avg_risk_score: { gte: filters.minRisk === 'HIGH' ? 45 : 70 } } });

		const data = await elasticFetch('/depshield-repo-scans/_search', env, {
			query: { bool: { must } },
			size: 20,
			sort: [{ avg_risk_score: { order: 'desc' } }],
		});

		return data?.hits?.hits?.map((h: any) => h._source) ?? [];
	} catch (err) {
		logger.error('searchScans failed', err);
		return [];
	}
};
