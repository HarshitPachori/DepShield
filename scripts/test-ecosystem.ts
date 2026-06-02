import { detectEcosystem, parseDependencies } from '@/backend/service/ecosystem.service';
import { scanAllPackages } from '@/backend/service/risk.service';
import { fetchCVEs } from '@/backend/service/osv.service';

const TEST_REPO = 'https://github.com/HarshitPachori/ride_fast';
const PLATFORM = 'github';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

const axiosCves = await fetchCVEs('axios', 'nodejs', '1.6.8');
console.log('Axios CVEs:');
for (const cve of axiosCves.slice(0, 5)) {
	console.log(`  ${cve.id}: ${cve.severity} — ${cve.description.slice(0, 60)}`);
}

const nextCves = await fetchCVEs('next', 'nodejs', '14.1.1');
console.log('\nNext CVEs:');
for (const cve of nextCves.slice(0, 5)) {
	console.log(`  ${cve.id}: ${cve.severity} — ${cve.description.slice(0, 60)}`);
}

console.log('Detecting ecosystem...');
const ecosystem = await detectEcosystem(TEST_REPO, PLATFORM, GITHUB_TOKEN);
console.log('Ecosystem:', ecosystem.ecosystem, '| basePath:', ecosystem.basePath);

console.log('\nParsing dependencies...');
const deps = await parseDependencies(TEST_REPO, PLATFORM, GITHUB_TOKEN);
console.log(`Found ${Object.keys(deps).length} packages`);

console.log('\nScanning all packages...');
const results = await scanAllPackages(deps, GITHUB_TOKEN, (scanned, total) => process.stdout.write(`\rProgress: ${scanned}/${total}`));

console.log('\n\nRisk Results (sorted by risk):');
for (const pkg of results) {
	const emoji =
		pkg.riskLevel === 'CRITICAL'
			? '🔴'
			: pkg.riskLevel === 'HIGH'
				? '🟠'
				: pkg.riskLevel === 'MEDIUM'
					? '🟡'
					: pkg.riskLevel === 'LOW'
						? '🔵'
						: '🟢';

	console.log(`\n${emoji} ${pkg.name} — ${pkg.riskScore}/100 ${pkg.riskLevel}`);
	console.log(`   Strategy: ${pkg.fixStrategy}`);
	console.log(`   CVEs: ${pkg.cves.length}`);
	console.log(`   ${pkg.explanation}`);
}
