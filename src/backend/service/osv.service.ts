import type { CVE, Ecosystem } from '@/types';
import logger from '../util/logger';

const OSV_ECOSYSTEM_MAP: Partial<Record<Ecosystem, string>> = {
	nodejs: 'npm',
	python: 'PyPI',
	go: 'Go',
	java: 'Maven',
	ruby: 'RubyGems',
	php: 'Packagist',
	rust: 'crates.io',
};

interface OsvVulnerability {
	id: string;
	summary?: string;
	severity?: Array<{ type: string; score: string }>;
	affected?: Array<{
		ranges?: Array<{
			type: string;
			events: Array<{ introduced?: string; fixed?: string }>;
		}>;
		versions?: string[];
	}>;
	database_specific?: { severity?: string };
}

// Low-CPU alternative to the heavy version cleaning regex
const cleanVersionString = (version: string): string => {
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
	const stripped = startIdx > 0 ? version.slice(startIdx) : version;

	// Quick fast path index search instead of regex split array manipulation
	const spaceIdx = stripped.indexOf(' ');
	return spaceIdx !== -1 ? stripped.slice(0, spaceIdx) : stripped;
};

export const fetchCVEs = async (packageName: string, ecosystem: Ecosystem, version?: string): Promise<CVE[]> => {
	try {
		const osvEcosystem = OSV_ECOSYSTEM_MAP[ecosystem];
		if (!osvEcosystem) {
			logger.warn('Unsupported ecosystem for OSV', { package: packageName, ecosystem });
			return [];
		}

		const body: Record<string, any> = {
			package: { name: packageName, ecosystem: osvEcosystem },
		};

		if (version) {
			body.version = cleanVersionString(version);
		}

		const res = await fetch('https://api.osv.dev/v1/query', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		});

		if (!res.ok) {
			logger.warn('OSV individual query failed', { package: packageName, status: res.status });
			return [];
		}

		const data = (await res.json()) as { vulns?: OsvVulnerability[] };
		const cves = data.vulns?.map(parseCVE) ?? [];

		if (cves.length > 0) {
			logger.info('OSV CVEs found', { package: packageName, count: cves.length });
		}

		return cves;
	} catch (err) {
		logger.error('fetchCVEs failed', err, { package: packageName });
		return [];
	}
};

export const fetchCVEsBatch = async (
	packages: Array<{ name: string; ecosystem: Ecosystem; version?: string }>,
): Promise<Map<string, CVE[]>> => {
	const results = new Map<string, CVE[]>();

	try {
		const queries = packages.map((pkg) => ({
			package: {
				name: pkg.name,
				ecosystem: OSV_ECOSYSTEM_MAP[pkg.ecosystem] ?? 'npm',
			},
			...(pkg.version ? { version: cleanVersionString(pkg.version) } : {}),
		}));

		logger.info('OSV batch query started', { count: packages.length });

		const res = await fetch('https://api.osv.dev/v1/querybatch', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ queries }),
		});

		if (!res.ok) {
			logger.warn('OSV batch query failed', { status: res.status });
			throw new Error(`OSV batch failed: ${res.status}`);
		}

		const data = (await res.json()) as { results: Array<{ vulns?: OsvVulnerability[] }> };

		let totalCves = 0;
		data.results.forEach((result, index) => {
			const cves = result.vulns?.map(parseCVE) ?? [];
			results.set(packages[index].name, cves);
			totalCves += cves.length;
		});

		logger.info('OSV batch query complete', { packages: packages.length, totalCves });
	} catch (err) {
		logger.error('fetchCVEsBatch failed, falling back to individual', err);

		const fallbackResults = await Promise.allSettled(packages.map((pkg) => fetchCVEs(pkg.name, pkg.ecosystem, pkg.version)));

		fallbackResults.forEach((result, index) => {
			if (result.status === 'rejected') {
				logger.error('OSV individual fallback failed', result.reason, { package: packages[index].name });
			}
			results.set(packages[index].name, result.status === 'fulfilled' ? result.value : []);
		});
	}

	return results;
};

const parseCVE = (vuln: OsvVulnerability): CVE => ({
	id: vuln.id,
	severity: detectSeverity(vuln),
	fixedVersion: extractFixedVersion(vuln),
	affectedVersions: extractAffectedVersions(vuln),
	description: vuln.summary ?? 'No description available',
});

const detectSeverity = (vuln: OsvVulnerability): 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' => {
	const cvssScore = vuln.severity?.find((s) => s.type === 'CVSS_V3')?.score;
	if (cvssScore) {
		const score = parseFloat(cvssScore);
		if (score >= 9.0) return 'CRITICAL';
		if (score >= 7.0) return 'HIGH';
		if (score >= 4.0) return 'MEDIUM';
		return 'LOW';
	}

	const dbSeverity = vuln.database_specific?.severity?.toUpperCase();
	if (dbSeverity === 'CRITICAL') return 'CRITICAL';
	if (dbSeverity === 'HIGH') return 'HIGH';
	if (dbSeverity === 'MODERATE' || dbSeverity === 'MEDIUM') return 'MEDIUM';
	if (dbSeverity === 'LOW') return 'LOW';

	return 'MEDIUM';
};

const extractFixedVersion = (vuln: OsvVulnerability): string | undefined => {
	for (const affected of vuln.affected ?? []) {
		for (const range of affected.ranges ?? []) {
			const fixedEvent = range.events.find((e) => e.fixed);
			if (fixedEvent?.fixed) return fixedEvent.fixed;
		}
	}
	return undefined;
};

const extractAffectedVersions = (vuln: OsvVulnerability): string[] => {
	const versions: string[] = [];
	for (const affected of vuln.affected ?? []) {
		if (!affected.versions) continue;
		for (const v of affected.versions) {
			versions.push(v);
			if (versions.length === 5) return versions;
		}
	}
	return versions;
};
