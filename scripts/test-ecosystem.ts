import { detectEcosystem, parseDependencies } from '@/backend/service/ecosystem.service';
import { fetchNpmPackageInfo, fetchNpmDownloadStats, fetchGithubCommitActivity } from '@/backend/service/npm.service';
import { fetchCVEsBatch } from '@/backend/service/osv.service';

const TEST_REPO = 'https://github.com/HarshitPachori/ride_fast';
const PLATFORM = 'github';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

console.log('Step 1 - Detecting ecosystem...');
const ecosystem = await detectEcosystem(TEST_REPO, PLATFORM, GITHUB_TOKEN);
console.log('Ecosystem:', ecosystem.ecosystem, '| basePath:', ecosystem.basePath);
console.log('All detected:', ecosystem.allDetected);

console.log('\nStep 2 - Parsing dependencies...');
const deps = await parseDependencies(TEST_REPO, PLATFORM, GITHUB_TOKEN);
const packageNames = Object.keys(deps);
console.log(`Found ${packageNames.length} packages`);

const results = await Promise.all(
	packageNames.map(async (name) => {
		const [info, stats, commitActivity] = await Promise.all([
			fetchNpmPackageInfo(name),
			fetchNpmDownloadStats(name),
			fetchGithubCommitActivity(name, GITHUB_TOKEN),
		]);
		return { name, info, stats, commitActivity };
	}),
);

const cveMap = await fetchCVEsBatch(packageNames.map((name) => ({ name, ecosystem: 'nodejs' as const })));

console.log('\nResults:');
for (const { name, info, stats, commitActivity } of results) {
	const cves = cveMap.get(name) ?? [];
	console.log(`\n ${name}`);
	console.log(`   Deprecated: ${info?.isDeprecated}`);
	console.log(`   Last published: ${info?.lastPublishedDaysAgo} days ago`);
	console.log(`   Weekly downloads: ${stats.weeklyDownloads.toLocaleString()}`);
	console.log(`   Download trend: ${stats.trendPercent}%`);
	console.log(`   Last commit: ${commitActivity.lastCommitDaysAgo} days ago`);
	console.log(`   Maintainer active: ${commitActivity.maintainerActive}`);
	console.log(`   CVEs: ${cves.length}`);
}
