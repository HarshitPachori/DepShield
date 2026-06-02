import type { CVE, Ecosystem, FixStrategy, PackageRisk, RiskLevel, RiskSignals } from '@/types';
import { fetchGithubCommitActivity, fetchNpmDownloadStats, fetchNpmPackageInfo } from '@backend/service/npm.service';
import { fetchPyPICommitActivity, fetchPyPIDownloadStats, fetchPyPIPackageInfo } from '@backend/service/pypi.service';
import { fetchCVEs } from '@backend/service/osv.service';
import logger from '@backend/util/logger';
import { getCachedPackage } from '@backend/service/elastic.service';

export const calculateRiskScore = (signals: RiskSignals): number => {
	let score = 0;

	// Abandonment signals
	if (signals.isDeprecated) score += 40;
	if (signals.lastCommitDaysAgo > 730) score += 25;
	else if (signals.lastCommitDaysAgo > 365) score += 15;
	else if (signals.lastCommitDaysAgo > 180) score += 8;
	else if (signals.lastCommitDaysAgo > 90) score += 3;
	if (signals.downloadTrendPercent < -50) score += 20;
	else if (signals.downloadTrendPercent < -25) score += 12;
	else if (signals.downloadTrendPercent < -10) score += 6;
	if (!signals.maintainerActive) score += 10;

	// CVE count based - severity data unreliable
	if (signals.openCveCount >= 20) score += 35;
	else if (signals.openCveCount >= 10) score += 28;
	else if (signals.openCveCount >= 5) score += 20;
	else if (signals.openCveCount >= 2) score += 12;
	else if (signals.openCveCount >= 1) score += 8;

	return Math.min(score, 100);
};

export const getRiskLevel = (score: number): RiskLevel => {
	if (score >= 80) return 'CRITICAL';
	if (score >= 60) return 'HIGH';
	if (score >= 35) return 'MEDIUM';
	if (score >= 15) return 'LOW';
	return 'SAFE';
};

export const determineFixStrategy = (signals: RiskSignals, cves: CVE[]): FixStrategy => {
	if (signals.isDeprecated) return 'migrate';
	if (signals.lastCommitDaysAgo > 730) return 'migrate';
	if (cves.some((c) => c.fixedVersion)) return 'version_bump';
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
	githubToken?: string,
): Promise<PackageRisk> => {
	const cached = await getCachedPackage(name, ecosystem).catch(() => null);
	if (cached) {
		logger.info('Cache hit', { package: name, ecosystem });
		return cached;
	}

	const isNodejs = ecosystem === 'nodejs';
	const isPython = ecosystem === 'python';
	const isJava = ecosystem === 'java';
	const isGo = ecosystem === 'go';

	const [pkgInfo, downloadStats, commitActivity, cves] = await Promise.all([
		isNodejs ? fetchNpmPackageInfo(name) : isPython ? fetchPyPIPackageInfo(name) : Promise.resolve(null),

		isNodejs
			? fetchNpmDownloadStats(name)
			: isPython
				? fetchPyPIDownloadStats(name)
				: Promise.resolve({ weeklyDownloads: 0, monthlyDownloads: 0, trendPercent: 0 }),

		isNodejs
			? fetchGithubCommitActivity(name, githubToken)
			: isPython
				? fetchPyPICommitActivity(name, githubToken)
				: Promise.resolve({ lastCommitDaysAgo: 0, maintainerActive: true }),

		fetchCVEs(name, ecosystem, declaredVersion.replace(/^[\^~>=<]/, '')),
	]);

	const signals: RiskSignals = {
		isDeprecated: pkgInfo?.isDeprecated ?? false,
		lastCommitDaysAgo: commitActivity?.lastCommitDaysAgo ?? 0,
		downloadTrendPercent: downloadStats?.trendPercent ?? 0,
		openCveCount: cves.length,
		maintainerActive: commitActivity?.maintainerActive ?? true,
		weeklyDownloads: downloadStats?.weeklyDownloads ?? 0,
		communitySignal: pkgInfo?.deprecationMessage,
	};

	const riskScore = calculateRiskScore(signals);
	const riskLevel = getRiskLevel(riskScore);
	const fixStrategy = determineFixStrategy(signals, cves);

	return {
		name,
		declaredVersion,
		ecosystem,
		riskScore,
		riskLevel,
		fixStrategy,
		signals,
		explanation: generateExplanation(name, signals, riskLevel),
		cves,
	};
};

export const scanAllPackages = async (
	deps: Record<string, string>,
	ecosystem: Ecosystem = 'nodejs',
	githubToken?: string,
	onProgress?: (scanned: number, total: number) => void,
): Promise<PackageRisk[]> => {
	const filtered = Object.entries(deps).filter(([name]) => !name.startsWith('@types/'));

	const total = filtered.length;
	const results: PackageRisk[] = [];
	const BATCH_SIZE = 10;
	const BATCH_DELAY = 500;

	for (let i = 0; i < filtered.length; i += BATCH_SIZE) {
		const batch = filtered.slice(i, i + BATCH_SIZE);

		const batchResults = await Promise.all(
			batch.map(([name, version]) => scanPackage(name, version, ecosystem, githubToken).catch(() => null)),
		);

		for (const result of batchResults) {
			if (result) results.push(result);
		}

		onProgress?.(Math.min(i + BATCH_SIZE, total), total);

		if (i + BATCH_SIZE < filtered.length) {
			await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY));
		}
	}

	return results.sort((a, b) => b.riskScore - a.riskScore);
};
