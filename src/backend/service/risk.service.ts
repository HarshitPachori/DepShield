import type { CVE, Ecosystem, FixStrategy, NpmDownloadStats, PackageRisk, RiskLevel, RiskSignals } from '@/types';
import { fetchGithubCommitActivity, fetchNpmDownloadStatsBatch, fetchNpmPackageInfo } from '@backend/service/npm.service';
import { fetchPyPICommitActivity, fetchPyPIDownloadStats, fetchPyPIJson, fetchPyPIPackageInfo } from '@backend/service/pypi.service';
import { fetchCVEsBatch } from '@backend/service/osv.service';
import logger from '@backend/util/logger';
import { getCachedPackage } from '@backend/service/elastic.service';

export const calculateRiskScore = (signals: RiskSignals): number => {
	let score = 0;

	if (signals.isDeprecated) score += 40;
	if (signals.lastCommitDaysAgo > 730) score += 35;
	else if (signals.lastCommitDaysAgo > 365) score += 20;
	else if (signals.lastCommitDaysAgo > 180) score += 8;
	else if (signals.lastCommitDaysAgo > 90) score += 3;
	if (signals.downloadTrendPercent < -50) score += 20;
	else if (signals.downloadTrendPercent < -25) score += 12;
	else if (signals.downloadTrendPercent < -10) score += 6;
	if (!signals.maintainerActive) score += 10;

	if (signals.openCveCount >= 20) score += 35;
	else if (signals.openCveCount >= 10) score += 28;
	else if (signals.openCveCount >= 5) score += 20;
	else if (signals.openCveCount >= 2) score += 12;
	else if (signals.openCveCount >= 1) score += 8;

	return Math.min(score, 100);
};

export const getRiskLevel = (score: number): RiskLevel => {
	if (score >= 70) return 'CRITICAL';
	if (score >= 45) return 'HIGH';
	if (score >= 25) return 'MEDIUM';
	if (score >= 10) return 'LOW';
	return 'SAFE';
};

export const determineFixStrategy = (signals: RiskSignals, cves: CVE[], ecosystem: Ecosystem): FixStrategy => {
	if (signals.isDeprecated) return 'migrate';
	if (signals.lastCommitDaysAgo > 730) return 'migrate';
	if (cves.some((c) => c.fixedVersion)) return 'version_bump';
	if (ecosystem === 'java' || ecosystem === 'go') return cves.length > 0 ? 'version_bump' : 'monitor';
	if (signals.openCveCount === 0) return 'monitor';
	return 'migrate';
};

export const generateExplanation = (name: string, signals: RiskSignals, riskLevel: RiskLevel): string => {
	const parts: string[] = [];

	if (signals.isDeprecated) {
		parts.push(`${name} has been officially deprecated`);
		if (signals.communitySignal) parts.push(signals.communitySignal);
	}
	if (signals.lastCommitDaysAgo > 365) parts.push(`no commits in ${Math.floor(signals.lastCommitDaysAgo / 30)} months`);
	else if (signals.lastCommitDaysAgo > 180) parts.push(`last commit ${signals.lastCommitDaysAgo} days ago`);
	if (signals.downloadTrendPercent < -25) parts.push(`downloads declining ${Math.abs(signals.downloadTrendPercent)}% over 3 months`);
	if (signals.openCveCount > 0)
		parts.push(`${signals.openCveCount} known ${signals.openCveCount === 1 ? 'vulnerability' : 'vulnerabilities'}`);
	if (!signals.maintainerActive) parts.push('maintainer appears inactive');

	if (parts.length === 0) return `${name} appears healthy.`;

	return `${name} is ${riskLevel.toLowerCase()} risk: ${parts.join(', ')}.`;
};

export const scanPackage = async (
	name: string,
	declaredVersion: string,
	ecosystem: Ecosystem = 'nodejs',
	env: CloudflareEnv,
	githubToken?: string,
	prefetchedCves?: CVE[],
	prefetchedDownloadStats?: NpmDownloadStats,
): Promise<PackageRisk> => {
	const cached = await getCachedPackage(name, ecosystem, env, declaredVersion).catch(() => null);
	if (cached) {
		logger.info('Cache hit', { package: name, ecosystem });
		return cached;
	}

	logger.info('Scanning package', { package: name, ecosystem, hasGithubToken: !!githubToken });

	const isNodejs = ecosystem === 'nodejs';
	const isPython = ecosystem === 'python';

	let pkgInfo: Awaited<ReturnType<typeof fetchNpmPackageInfo>> = null;
	let downloadStats = { weeklyDownloads: 0, monthlyDownloads: 0, trendPercent: 0 };
	let commitActivity = { lastCommitDaysAgo: 0, maintainerActive: true };

	if (isNodejs) {
		pkgInfo = await fetchNpmPackageInfo(name, env.NPM_TOKEN);

		logger.debug('npm package info fetched', {
			package: name,
			version: pkgInfo?.version,
			isDeprecated: pkgInfo?.isDeprecated,
			repository: pkgInfo?.repository ?? 'none',
		});
		downloadStats = prefetchedDownloadStats ?? { weeklyDownloads: 0, monthlyDownloads: 0, trendPercent: 0 };
		commitActivity = await fetchGithubCommitActivity(name, githubToken, pkgInfo?.repository, env.NPM_TOKEN);
	} else if (isPython) {
		const [pypiData, pypiStats] = await Promise.all([fetchPyPIJson(name), fetchPyPIDownloadStats(name)]);

		logger.debug('PyPI data fetched', { package: name, hasData: !!pypiData });

		[pkgInfo, commitActivity] = await Promise.all([
			fetchPyPIPackageInfo(name, pypiData),
			fetchPyPICommitActivity(name, githubToken, pypiData),
		]);

		downloadStats = pypiStats;
	} else {
		logger.warn('Unsupported ecosystem in scanPackage', { package: name, ecosystem });
	}

	if (!pkgInfo) logger.warn('pkgInfo null', { package: name, ecosystem });
	if (downloadStats.weeklyDownloads === 0) logger.warn('weeklyDownloads zero', { package: name });
	if (commitActivity.lastCommitDaysAgo === 365) logger.warn('commitActivity fallback', { package: name });

	const cves = prefetchedCves ?? [];
	const signals: RiskSignals = {
		isDeprecated: pkgInfo?.isDeprecated ?? false,
		lastCommitDaysAgo: commitActivity.lastCommitDaysAgo,
		downloadTrendPercent: downloadStats.trendPercent,
		openCveCount: cves.length,
		maintainerActive: commitActivity.maintainerActive,
		weeklyDownloads: downloadStats.weeklyDownloads,
		communitySignal: pkgInfo?.deprecationMessage,
	};

	const riskScore = calculateRiskScore(signals);
	const riskLevel = getRiskLevel(riskScore);
	const fixStrategy = determineFixStrategy(signals, cves, ecosystem);
	const explanation = generateExplanation(name, signals, riskLevel);

	logger.info('Package scan complete', {
		package: name,
		riskLevel,
		riskScore,
		lastCommitDaysAgo: commitActivity.lastCommitDaysAgo,
		weeklyDownloads: downloadStats.weeklyDownloads,
		cveCount: cves.length,
		isDeprecated: pkgInfo?.isDeprecated ?? false,
	});

	return {
		name,
		declaredVersion,
		ecosystem,
		riskScore,
		riskLevel,
		fixStrategy,
		signals,
		explanation,
		cves,
	};
};

export const scanAllPackages = async (
	deps: Record<string, string>,
	ecosystem: Ecosystem = 'nodejs',
	env: CloudflareEnv,
	githubToken?: string,
	onProgress?: (scanned: number, total: number) => void,
): Promise<PackageRisk[]> => {
	const filtered = Object.entries(deps).filter(([name]) => !name.startsWith('@types/'));
	const total = filtered.length;
	const results: PackageRisk[] = [];
	const BATCH_SIZE = 5;
	const BATCH_DELAY = 300;

	logger.info('scanAllPackages started', { total, ecosystem, hasGithubToken: !!githubToken });

	const packageList = filtered.map(([name, version]) => {
		let startIdx = 0;
		while (
			startIdx < version.length &&
			(version[startIdx] === '^' ||
				version[startIdx] === '~' ||
				version[startIdx] === '>' ||
				version[startIdx] === '=' ||
				version[startIdx] === '<')
		) {
			startIdx++;
		}

		return {
			name,
			ecosystem,
			version: startIdx > 0 ? version.slice(startIdx) : version,
		};
	});

	const [cveMap, downloadMap] = await Promise.all([
		fetchCVEsBatch(packageList).catch((err) => {
			logger.error('fetchCVEsBatch failed', err);
			return new Map<string, CVE[]>();
		}),
		ecosystem === 'nodejs'
			? fetchNpmDownloadStatsBatch(
					filtered.map(([name]) => name),
					env,
				).catch((err) => {
					logger.error('fetchNpmDownloadStatsBatch failed', err);
					return new Map<string, NpmDownloadStats>();
				})
			: Promise.resolve(new Map<string, NpmDownloadStats>()),
	]);

	logger.info('CVE batch complete', { packages: packageList.length, withCves: [...cveMap.values()].filter((v) => v.length > 0).length });
	logger.info('Downloads batch complete', {
		packages: filtered.length,
		withData: [...downloadMap.values()].filter((v) => v.weeklyDownloads > 0).length,
	});

	for (let i = 0; i < filtered.length; i += BATCH_SIZE) {
		const batch = filtered.slice(i, i + BATCH_SIZE);

		logger.info('Processing batch', { batchStart: i, batchSize: batch.length, total });

		for (const [name, version] of batch) {
			const result = await scanPackage(name, version, ecosystem, env, githubToken, cveMap.get(name) ?? [], downloadMap.get(name)).catch(
				(err) => {
					logger.error('scanPackage failed', err, { package: name });
					return null;
				},
			);
			if (result) results.push(result);
			onProgress?.(results.length, total);
		}

		if (i + BATCH_SIZE < filtered.length) {
			await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY));
		}
	}

	logger.info('scanAllPackages complete', { total, scanned: results.length });
	return results.sort((a, b) => b.riskScore - a.riskScore);
};
