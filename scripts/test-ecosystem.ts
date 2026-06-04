import { detectEcosystem, parseDependencies } from '@/backend/service/ecosystem.service';
import { scanAllPackages } from '@/backend/service/risk.service';

// const TEST_REPO = 'https://github.com/HarshitPachori/ride_fast';
// const TEST_REPO = 'https://github.com/HarshitPachori/TodoList_SpringBoot';
// const TEST_REPO = 'https://github.com/appuio/example-spring-boot-helloworld';
// const TEST_REPO = 'https://github.com/otahina/PowerPoint-Generator-Python-Project';
const TEST_REPO = 'https://github.com/vishnuBoppani/how-to-insert-data-in-mongodb-using-node-js-send-to-mail-using-nodemailer-';

const PLATFORM = 'github';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

// console.log('Detecting ecosystem...');
// const ecosystem = await detectEcosystem(TEST_REPO, PLATFORM, GITHUB_TOKEN);
// console.log('Ecosystem:', ecosystem.ecosystem, '| basePath:', ecosystem.basePath);

// console.log('\nParsing dependencies...');
// const deps = await parseDependencies(TEST_REPO, PLATFORM, GITHUB_TOKEN);
// console.log(`Found ${Object.keys(deps).length} packages`);

// console.log('\nScanning all packages...');
// const results = await scanAllPackages(deps, ecosystem.ecosystem ?? 'nodejs', GITHUB_TOKEN, (scanned, total) =>
// 	process.stdout.write(`\rProgress: ${scanned}/${total}`),
// );

// console.log('\n\nRisk Results (sorted by risk):');
// for (const pkg of results) {
// 	const emoji =
// 		pkg.riskLevel === 'CRITICAL'
// 			? '🔴'
// 			: pkg.riskLevel === 'HIGH'
// 				? '🟠'
// 				: pkg.riskLevel === 'MEDIUM'
// 					? '🟡'
// 					: pkg.riskLevel === 'LOW'
// 						? '🔵'
// 						: '🟢';

// 	console.log(`\n${emoji} ${pkg.name} - ${pkg.riskScore}/100 ${pkg.riskLevel}`);
// 	console.log(`   Strategy: ${pkg.fixStrategy}`);
// 	console.log(`   CVEs: ${pkg.cves.length}`);
// 	console.log(`   ${pkg.explanation}`);
// }

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const env = {} as any;

console.log('Detecting ecosystem...');
const ecosystem = await detectEcosystem(TEST_REPO, 'github', GITHUB_TOKEN);
console.log('Ecosystem:', ecosystem.ecosystem);

console.log('\nParsing dependencies...');
const deps = await parseDependencies(TEST_REPO, 'github', GITHUB_TOKEN);
console.log(`Found ${Object.keys(deps).length} packages`);

console.log('\nScanning with Gemini...');
const results = await scanAllPackages(
	deps,
	ecosystem.ecosystem ?? 'nodejs',
	env,
	GITHUB_TOKEN,
	(scanned, total) => process.stdout.write(`\rProgress: ${scanned}/${total}`),
	GEMINI_API_KEY,
	GROQ_API_KEY,
);

console.log('\n\nRisk Results:');
for (const pkg of results.slice(0, 5)) {
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
	console.log(`   Alternative: ${pkg.alternative ?? 'none'}`);
	console.log(`   Strategy: ${pkg.fixStrategy}`);
	console.log(`   CVEs: ${pkg.cves.length}`);
	console.log(`   Alternative Reason: ${pkg.alternativeReason ?? 'none'}`);
	console.log(`   Explanation: ${pkg.explanation}`);
}
