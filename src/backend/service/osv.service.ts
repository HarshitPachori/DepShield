import type { CVE, Ecosystem } from '@/types';

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

export const fetchCVEs = async (packageName: string, ecosystem: Ecosystem, version?: string): Promise<CVE[]> => {
	try {
		const osvEcosystem = OSV_ECOSYSTEM_MAP[ecosystem];
		if (!osvEcosystem) return [];

		const body: Record<string, any> = {
			package: {
				name: packageName,
				ecosystem: osvEcosystem,
			},
		};

		if (version) {
			body.version = version.replace(/^[\^~>=<]/, '').split(' ')[0];
		}

		const res = await fetch('https://api.osv.dev/v1/query', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		});

		if (!res.ok) return [];

		const data = (await res.json()) as { vulns?: OsvVulnerability[] };

		if (!data.vulns?.length) return [];

		return data.vulns.map((vuln) => parseCVE(vuln));
	} catch {
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
			...(pkg.version ? { version: pkg.version.replace(/^[\^~>=<]/, '').split(' ')[0] } : {}),
		}));

		const res = await fetch('https://api.osv.dev/v1/querybatch', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ queries }),
		});

		if (!res.ok) return results;

		const data = (await res.json()) as { results: Array<{ vulns?: OsvVulnerability[] }> };

		data.results.forEach((result, index) => {
			const pkg = packages[index];
			const cves = result.vulns?.map((v) => parseCVE(v)) ?? [];
			results.set(pkg.name, cves);
		});
	} catch {
		for (const pkg of packages) {
			const cves = await fetchCVEs(pkg.name, pkg.ecosystem, pkg.version);
			results.set(pkg.name, cves);
		}
	}

	return results;
};

const parseCVE = (vuln: OsvVulnerability): CVE => {
	const severity = detectSeverity(vuln);
	const fixedVersion = extractFixedVersion(vuln);
	const affectedVersions = extractAffectedVersions(vuln);

	return {
		id: vuln.id,
		severity,
		affectedVersions,
		fixedVersion,
		description: vuln.summary ?? 'No description available',
	};
};

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
		if (affected.versions) versions.push(...affected.versions);
	}
	return versions.slice(0, 5);
};
