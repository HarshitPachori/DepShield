import { detectEcosystem, parseDependencies } from '@/backend/service/ecosystem.service';
import { scanAllPackages } from '@/backend/service/risk.service';

// const TEST_REPO = 'https://github.com/HarshitPachori/ride_fast';
// const TEST_REPO = 'https://github.com/HarshitPachori/TodoList_SpringBoot';
const TEST_REPO = 'https://github.com/appuio/example-spring-boot-helloworld';
// const TEST_REPO = 'https://github.com/otahina/PowerPoint-Generator-Python-Project';

const PLATFORM = 'github';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

console.log('Detecting ecosystem...');
const ecosystem = await detectEcosystem(TEST_REPO, PLATFORM, GITHUB_TOKEN);
console.log('Ecosystem:', ecosystem.ecosystem, '| basePath:', ecosystem.basePath);

console.log('\nParsing dependencies...');
const deps = await parseDependencies(TEST_REPO, PLATFORM, GITHUB_TOKEN);
console.log(`Found ${Object.keys(deps).length} packages`);

console.log('\nScanning all packages...');
const results = await scanAllPackages(deps, ecosystem.ecosystem ?? 'nodejs', GITHUB_TOKEN, (scanned, total) =>
	process.stdout.write(`\rProgress: ${scanned}/${total}`),
);

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
