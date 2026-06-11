import { getGoogleAccessToken, parseGitlabUrl } from '@backend/helper';
import logger from '@backend/util/logger';
import type { PackageSignal } from './elastic.service';
import {
	getCommunityMigrationContext,
	indexPackageSignal,
	queryDeprecationStatus,
	queryMigrationSignals,
	queryPackageTrends,
	searchCommunitySignals,
} from './elastic.service';

import { decryptToken } from '@backend/util/encryption';
import { computePackageHealthScore, getMigrationIntelligence } from './elastic.service';

const getDecryptedJobToken = async (jobId: string, env: CloudflareEnv): Promise<string | null> => {
	try {
		const encrypted = await env.KV.get(`job-token:${jobId}`);
		if (!encrypted) return null;
		return await decryptToken(encrypted, env.ENCRYPTION_KEY);
	} catch (err) {
		logger.error('Failed to decrypt job token', err, { jobId });
		return null;
	}
};

export const queryElastic = async (
	packageName: string,
	queryType: 'alternatives' | 'trends' | 'signals' | 'health' | 'intelligence',
	env: CloudflareEnv,
): Promise<any> => {
	logger.info('queryElastic called', { packageName, queryType });

	try {
		if (queryType === 'alternatives') {
			return await queryMigrationSignals(packageName, env);
		}
		if (queryType === 'trends') {
			return await queryPackageTrends(packageName, env);
		}
		if (queryType === 'signals') {
			const community = await searchCommunitySignals(packageName, env);
			const deprecation = await queryDeprecationStatus(packageName, env);
			return {
				package: packageName,
				community_signals: community,
				deprecation_status: deprecation,
			};
		}
		if (queryType === 'health') {
			return await computePackageHealthScore(packageName, env);
		}
		if (queryType === 'intelligence') {
			return await getMigrationIntelligence(env);
		}

		return { error: 'Unknown query type' };
	} catch (err) {
		logger.error('queryElastic failed', err, { packageName, queryType });
		return { error: err instanceof Error ? err.message : 'Query failed' };
	}
};

const sanitizeBranchPart = (name: string) =>
	name
		.replace(/[@/\\:*?"<>|]/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-+|-+$/g, '');

const getJobContext = async (
	jobId: string,
	env: CloudflareEnv,
): Promise<{ ecosystem: string; dependencyFile: string; basePath: string }> => {
	try {
		const job = (await env.KV.get(`job:${jobId}`, 'json')) as Record<string, any> | null;
		return {
			ecosystem: job?.ecosystem ?? 'nodejs',
			dependencyFile: job?.dependencyFile ?? 'package.json',
			basePath: job?.basePath ?? '',
		};
	} catch {
		return { ecosystem: 'nodejs', dependencyFile: 'package.json', basePath: '' };
	}
};

const IMPORT_SEARCH_QUERIES = (pkg: string, ecosystem: string): string[] => {
	switch (ecosystem) {
		case 'python':
			return [`import ${pkg}`, `from ${pkg} import`];
		case 'go':
			return [`"${pkg}"`, `'${pkg}'`];
		case 'java':
			return [`import ${pkg}`, `${pkg.split(':')[1] ?? pkg}`];
		default: // nodejs
			return [`require("${pkg}")`, `require('${pkg}')`, `from "${pkg}"`, `from '${pkg}'`];
	}
};

const resolveTargetVersion = async (
	from_pkg: string,
	to_pkg: string,
	manifestContent: string,
	ecosystem: string,
	env: CloudflareEnv,
	gcpToken?: string,
): Promise<string> => {
	let latestVersion: string | null = null;

	try {
		switch (ecosystem) {
			case 'nodejs': {
				const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(to_pkg)}/latest`);
				if (res.ok) {
					const data = (await res.json()) as any;
					if (data.version) latestVersion = `^${data.version}`;
				}
				break;
			}
			case 'python': {
				const res = await fetch(`https://pypi.org/pypi/${encodeURIComponent(to_pkg)}/json`);
				if (res.ok) {
					const data = (await res.json()) as any;
					const version = data.info?.version;
					if (version) latestVersion = `>=${version}`;
				}
				break;
			}
			case 'go': {
				const res = await fetch(`https://proxy.golang.org/${encodeURIComponent(to_pkg)}/@latest`);
				if (res.ok) {
					const data = (await res.json()) as any;
					if (data.Version) latestVersion = data.Version;
				}
				break;
			}
			case 'java': {
				const res = await fetch(
					`https://search.maven.org/solrsearch/select?q=g:"${to_pkg.split(':')[0]}" AND a:"${to_pkg.split(':')[1]}"&rows=1&wt=json`,
				);
				if (res.ok) {
					const data = (await res.json()) as any;
					const version = data.response?.docs?.[0]?.latestVersion;
					if (version) latestVersion = version;
				}
				break;
			}
		}
	} catch (err) {
		logger.warn('Registry version fetch failed', { to_pkg, ecosystem });
	}

	if (!env.GCP_SERVICE_ACCOUNT || !env.GOOGLE_CLOUD_PROJECT_ID) {
		return latestVersion ?? 'latest';
	}

	try {
		const accessToken = gcpToken ?? (await getGoogleAccessToken(env.GCP_SERVICE_ACCOUNT));
		const projectId = env.GOOGLE_CLOUD_PROJECT_ID;
		const url = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent`;

		const prompt = `You are a dependency version expert for ${ecosystem} projects.

A project is migrating from "${from_pkg}" to "${to_pkg}".
${latestVersion ? `The latest available version of "${to_pkg}" is ${latestVersion}.` : `No registry version was found for "${to_pkg}".`}

Here is the project's current manifest file:
${manifestContent}

Based on:
- The runtime/language version constraints in the manifest (Node.js engines field, Python requires, Java source/target, Go version directive etc.)
- The versions of other dependencies already in the manifest
- Known compatibility between "${to_pkg}" and these constraints

What is the most compatible version specifier for "${to_pkg}" in this ${ecosystem} project?

Respond with ONLY the version specifier as it should appear in the manifest file.
Examples by ecosystem:
- nodejs: ^2.0.0 or ~1.7.0
- python: >=2.28.0 or ==2.28.0
- java: 5.2.0 (just the version number)
- go: v1.9.0

No explanation. No package name. Just the version string.`;

		const res = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
			body: JSON.stringify({
				contents: [{ role: 'user', parts: [{ text: prompt }] }],
				generationConfig: { temperature: 0, maxOutputTokens: 20 },
			}),
		});

		if (res.ok) {
			const data = (await res.json()) as any;
			const suggested = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
			if (suggested && /^[v\^~><=]?[\d]/.test(suggested)) {
				logger.info('Gemini resolved version', { to_pkg, ecosystem, version: suggested });
				return suggested;
			}
		}
	} catch (err) {
		logger.warn('Gemini version resolution failed, using registry version', { to_pkg, ecosystem });
	}

	return latestVersion ?? 'latest';
};

const getSourceExtensions = (ecosystem: string): string[] => {
	switch (ecosystem) {
		case 'python':
			return ['.py'];
		case 'go':
			return ['.go'];
		case 'java':
			return ['.java', '.kt'];
		default:
			return ['.js', '.ts', '.mjs', '.cjs', '.jsx', '.tsx'];
	}
};

const searchAndTransformImports = async (
	owner: string,
	repo: string,
	from_pkg: string,
	to_pkg: string,
	branchName: string,
	defaultBranch: string,
	token: string,
	isGitLab: boolean,
	ecosystem: string,
	manifestPath: string,
	env: CloudflareEnv,
	gcptoken?: string,
	projectId?: string,
): Promise<void> => {
	if (!isGitLab) {
		const treeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${defaultBranch}?recursive=1`, {
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: 'application/vnd.github.v3+json',
				'User-Agent': 'DepShield/1.0',
			},
		});

		if (!treeRes.ok) {
			logger.warn('Failed to fetch git tree', { status: treeRes.status, owner, repo });
			return;
		}

		const treeData = (await treeRes.json()) as any;
		const sourceExtensions = getSourceExtensions(ecosystem);

		const sourceFiles = (treeData.tree ?? [])
			.filter(
				(f: any) =>
					f.type === 'blob' &&
					f.path !== manifestPath &&
					!f.path.endsWith(`/${manifestPath}`) &&
					sourceExtensions.some((ext: string) => f.path.endsWith(ext)),
			)
			.slice(0, 50);

		logger.info('Files to scan', { count: sourceFiles.length, from_pkg, ecosystem });

		for (const file of sourceFiles) {
			const fileRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${file.path}?ref=${branchName}`, {
				headers: {
					Authorization: `Bearer ${token}`,
					Accept: 'application/vnd.github.v3+json',
					'User-Agent': 'DepShield/1.0',
				},
			});

			if (!fileRes.ok) continue;

			const fileData = (await fileRes.json()) as any;
			const original = Buffer.from(fileData.content, 'base64').toString('utf-8');

			if (!original.includes(from_pkg)) continue;

			const { transformed, changed } = await transformFileWithAI(
				{ file_path: file.path, file_content: original, from_pkg, to_pkg, ecosystem },
				env,
				gcptoken,
			);

			if (!changed) continue;

			const commitRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${file.path}`, {
				method: 'PUT',
				headers: {
					Authorization: `Bearer ${token}`,
					'Content-Type': 'application/json',
					'User-Agent': 'DepShield/1.0',
				},
				body: JSON.stringify({
					message: `chore: migrate ${from_pkg} usage to ${to_pkg} in ${file.path}`,
					content: Buffer.from(transformed).toString('base64'),
					sha: fileData.sha,
					branch: branchName,
				}),
			});

			if (!commitRes.ok) {
				const err = await commitRes.text();
				logger.warn('Failed to commit transformed file', { file: file.path, error: err });
			} else {
				logger.info('Source file transformed', { file: file.path, from: from_pkg, to: to_pkg });
			}

			await new Promise((r) => setTimeout(r, 500));
		}

		return;
	}

	const searchQueries = IMPORT_SEARCH_QUERIES(from_pkg, ecosystem);

	const seenPaths = new Set<string>();

	for (const query of searchQueries) {
		const searchRes = await fetch(
			`https://gitlab.com/api/v4/projects/${projectId}/search?scope=blobs&search=${encodeURIComponent(query)}`,
			{ headers: { 'PRIVATE-TOKEN': token, 'User-Agent': 'DepShield/1.0' } },
		);

		if (!searchRes.ok) {
			logger.warn('GitLab search failed', { query, status: searchRes.status });
			continue;
		}

		const searchData = (await searchRes.json()) as any;
		const sourceFiles = (searchData ?? []).slice(0, 10);

		logger.info('GitLab search results', { query, count: sourceFiles.length });

		for (const file of sourceFiles) {
			if (file.path === manifestPath || file.path.endsWith(`/${manifestPath}`)) continue;
			if (seenPaths.has(file.path)) continue;
			seenPaths.add(file.path);

			const fileRes = await fetch(
				`https://gitlab.com/api/v4/projects/${projectId}/repository/files/${encodeURIComponent(file.path)}?ref=${branchName}`,
				{ headers: { 'PRIVATE-TOKEN': token, 'User-Agent': 'DepShield/1.0' } },
			);

			if (!fileRes.ok) continue;

			const fileData = (await fileRes.json()) as any;
			const original = Buffer.from(fileData.content, 'base64').toString('utf-8');

			if (!original.includes(from_pkg)) continue;

			const { transformed, changed } = await transformFileWithAI(
				{ file_path: file.path, file_content: original, from_pkg, to_pkg, ecosystem },
				env,
				gcptoken,
			);

			if (!changed) continue;

			const commitRes = await fetch(`https://gitlab.com/api/v4/projects/${projectId}/repository/commits`, {
				method: 'POST',
				headers: { 'PRIVATE-TOKEN': token, 'Content-Type': 'application/json', 'User-Agent': 'DepShield/1.0' },
				body: JSON.stringify({
					branch: branchName,
					commit_message: `chore: migrate ${from_pkg} usage to ${to_pkg} in ${file.path}`,
					actions: [{ action: 'update', file_path: file.path, content: transformed }],
				}),
			});

			if (!commitRes.ok) {
				const err = await commitRes.text();
				logger.warn('Failed to commit transformed file', { file: file.path, error: err });
			} else {
				logger.info('Source file transformed', { file: file.path, from: from_pkg, to: to_pkg });
			}
		}
	}
};

export const createGitHubPR = async (
	input: { from_pkg: string; to_pkg: string; owner: string; repo: string; job_id?: string },
	env: CloudflareEnv,
): Promise<any> => {
	const { from_pkg, to_pkg, owner, repo, job_id } = input;
	const branchName = `depshield/migrate-${sanitizeBranchPart(from_pkg)}-to-${sanitizeBranchPart(to_pkg)}`;

	logger.info('createGitHubPR started', { from_pkg, to_pkg, owner, repo, job_id });

	let token = env.GITHUB_TOKEN;
	if (job_id) {
		const decrypted = await getDecryptedJobToken(job_id, env);
		if (decrypted) {
			token = decrypted;
			logger.info('Using decrypted job token', { job_id });
		} else {
			logger.warn('No decrypted token, falling back to env token', { job_id });
		}
	}
	const { ecosystem, dependencyFile, basePath } = job_id
		? await getJobContext(job_id, env)
		: { ecosystem: 'nodejs', dependencyFile: 'package.json', basePath: '' };

	const manifestPath = basePath ? `${basePath}/${dependencyFile}` : dependencyFile;

	try {
		const mainRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
			headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json', 'User-Agent': 'DepShield/1.0' },
		});
		if (!mainRes.ok) {
			const err = await mainRes.text();
			logger.error('Failed to fetch repo info', { error: err, status: mainRes.status });
			return { error: `Failed to fetch repo: ${mainRes.status}` };
		}
		const mainData = (await mainRes.json()) as any;
		const defaultBranch = mainData.default_branch;

		const branchRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${defaultBranch}`, {
			headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json', 'User-Agent': 'DepShield/1.0' },
		});
		if (!branchRes.ok) {
			const err = await branchRes.text();
			logger.error('Failed to fetch branch ref', { error: err, status: branchRes.status });
			return { error: `Failed to fetch branch ref: ${branchRes.status}` };
		}
		const branchData = (await branchRes.json()) as any;
		const mainSha = branchData.object.sha;

		const createBranchRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'DepShield/1.0' },
			body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: mainSha }),
		});

		let branchAlreadyExisted = false;

		if (!createBranchRes.ok) {
			const errText = await createBranchRes.text();
			let errData: any = {};
			try {
				errData = JSON.parse(errText);
			} catch {}

			if (createBranchRes.status === 422 || errData.status === '422') {
				branchAlreadyExisted = true;
				logger.warn('Branch already exists, reusing', { branchName });
			} else {
				logger.error('Failed to create branch', { error: errText });
				return { error: 'Failed to create branch' };
			}
		}
		logger.info('Branch created', { branchName });

		const manifestRef = branchAlreadyExisted ? branchName : defaultBranch;
		const contentRef = defaultBranch;
		const shaRef = manifestRef;

		const packageJsonRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${manifestPath}?ref=${shaRef}`, {
			headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json', 'User-Agent': 'DepShield/1.0' },
		});

		if (!packageJsonRes.ok) {
			logger.warn('Could not find package.json, skipping code changes');
		} else {
			const packageJsonData = (await packageJsonRes.json()) as any;
			const fileSha = packageJsonData.sha;

			const gcpToken = env.GCP_SERVICE_ACCOUNT ? await getGoogleAccessToken(env.GCP_SERVICE_ACCOUNT).catch(() => undefined) : undefined;
			const contentRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${manifestPath}?ref=${defaultBranch}`, {
				headers: {
					Authorization: `Bearer ${token}`,
					Accept: 'application/vnd.github.v3+json',
					'User-Agent': 'DepShield/1.0',
				},
			});
			const contentData = (await contentRes.json()) as any;
			const manifestContent = Buffer.from(contentData.content, 'base64').toString('utf-8');
			const targetVersion = await resolveTargetVersion(from_pkg, to_pkg, manifestContent, ecosystem, env, gcpToken);

			let content = manifestContent.replace(new RegExp(`"${from_pkg}":\\s*"[^"]*"`, 'g'), `"${to_pkg}": "${targetVersion}"`);

			const commitRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${manifestPath}`, {
				method: 'PUT',
				headers: {
					Authorization: `Bearer ${token}`,
					'Content-Type': 'application/json',
					'User-Agent': 'DepShield/1.0',
				},
				body: JSON.stringify({
					message: `chore: migrate ${from_pkg} to ${to_pkg}`,
					content: Buffer.from(content).toString('base64'),
					sha: fileSha,
					branch: branchName,
				}),
			});

			if (!commitRes.ok) {
				const err = await commitRes.text();
				logger.warn('Failed to commit changes', { error: err });
			} else {
				logger.info('Changes committed', { branchName });
			}

			await searchAndTransformImports(
				owner,
				repo,
				from_pkg,
				to_pkg,
				branchName,
				defaultBranch,
				token,
				false,
				ecosystem,
				manifestPath,
				env,
				gcpToken,
			);
		}

		const communityContext = await getCommunityMigrationContext(from_pkg, env).catch(() => null);
		const communityLine = communityContext
			? communityContext?.migrationCount > 0
				? `\n> 💡 **Community insight:** ${communityContext.migrationCount} other projects have migrated from \`${from_pkg}\` to \`${communityContext.topAlternative}\` based on DepShield community data.\n`
				: ''
			: '';
		const prRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${token}`,
				'Content-Type': 'application/json',
				'User-Agent': 'DepShield/1.0',
			},
			body: JSON.stringify({
				title: `chore: migrate ${from_pkg} to ${to_pkg}`,
				head: branchName,
				base: defaultBranch,
				body: `## Dependency Migration

**Package:** ${from_pkg} → ${to_pkg}

### What Changed
- Replaced \`${from_pkg}\` with \`${to_pkg}\` in package.json
- Updated all imports in source files

### Why This Change
${communityLine ?? ''}
- \`${from_pkg}\` is deprecated/unmaintained
- \`${to_pkg}\` is the recommended community replacement
- Reduces security vulnerabilities
- Better performance and active maintenance

### Testing
- [ ] Run \`npm install\`
- [ ] Run test suite: \`npm test\`
- [ ] Verify builds: \`npm run build\`
- [ ] Check functionality in dev environment

### Migration Notes
API compatibility: Most APIs are drop-in replacements. Refer to [migration guide](https://github.com/${to_pkg}/${to_pkg}#migration).

---
*This PR was automatically created by DepShield agent.*`,
				draft: false,
			}),
		});

		if (!prRes.ok) {
			const errText = await prRes.text();
			const existingPrRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls?head=${owner}:${branchName}&state=open`, {
				headers: {
					Authorization: `Bearer ${token}`,
					Accept: 'application/vnd.github.v3+json',
					'User-Agent': 'DepShield/1.0',
				},
			});
			if (existingPrRes.ok) {
				const existingPrs = (await existingPrRes.json()) as any[];
				if (existingPrs.length > 0) {
					const pr = existingPrs[0];
					logger.info('PR already exists, returning existing', { prUrl: pr.html_url });
					return {
						pr_url: pr.html_url,
						pr_number: pr.number,
						branch_name: branchName,
						status: 'existing',
						message: `Existing PR: ${pr.html_url}`,
					};
				}
			}
			logger.error('Failed to create PR', { error: errText });
			return { error: 'Failed to create PR' };
		}

		const pr = (await prRes.json()) as any;

		logger.info('GitHub PR created', { prUrl: pr.html_url });

		await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${pr.number}/labels`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${token}`,
				'Content-Type': 'application/json',
				'User-Agent': 'DepShield/1.0',
			},
			body: JSON.stringify({
				labels: ['dependencies', 'automated'],
			}),
		});

		return {
			pr_url: pr.html_url,
			pr_number: pr.number,
			branch_name: branchName,
			status: 'created',
			message: `PR created: ${pr.html_url}`,
		};
	} catch (err) {
		logger.error('createGitHubPR failed', err, { from_pkg, to_pkg });
		return { error: err instanceof Error ? err.message : 'Unknown error' };
	}
};

const TRANSFORM_PATTERNS = (from_pkg: string, to_pkg: string, ecosystem: string) => {
	switch (ecosystem) {
		case 'python':
			return [
				{ pattern: new RegExp(`^import ${from_pkg}$`, 'gm'), replacement: `import ${to_pkg}` },
				{ pattern: new RegExp(`^from ${from_pkg}(\\s+import)`, 'gm'), replacement: `from ${to_pkg}$1` },
			];
		case 'go':
			return [{ pattern: new RegExp(`"${from_pkg}"`, 'g'), replacement: `"${to_pkg}"` }];
		default: // nodejs
			return [
				{ pattern: new RegExp(`require\\(['"]${from_pkg}['"]\\)`, 'g'), replacement: `require('${to_pkg}')` },
				{ pattern: new RegExp(`from\\s+['"]${from_pkg}['"]`, 'g'), replacement: `from '${to_pkg}'` },
			];
	}
};

export const createGitLabMR = async (
	input: { from_pkg: string; to_pkg: string; repo: string; job_id?: string },
	env: CloudflareEnv,
): Promise<any> => {
	const { from_pkg, to_pkg, repo, job_id } = input;
	const branchName = `depshield/migrate-${sanitizeBranchPart(from_pkg)}-to-${sanitizeBranchPart(to_pkg)}`;

	logger.info('createGitLabMR started', { from_pkg, to_pkg, repo, job_id });

	let token = env.GITLAB_TOKEN;
	if (job_id) {
		const decrypted = await getDecryptedJobToken(job_id, env);
		if (decrypted) {
			token = decrypted;
			logger.info('Using decrypted job token', { job_id });
		} else {
			logger.warn('No decrypted token, falling back to env token', { job_id });
		}
	}

	const { ecosystem, dependencyFile, basePath } = job_id
		? await getJobContext(job_id, env)
		: { ecosystem: 'nodejs', dependencyFile: 'package.json', basePath: '' };

	const manifestPath = basePath ? `${basePath}/${dependencyFile}` : dependencyFile;

	try {
		const { fullPath } = parseGitlabUrl(`https://gitlab.com/${repo}`);
		const projectId = encodeURIComponent(fullPath);

		const mainRes = await fetch(`https://gitlab.com/api/v4/projects/${projectId}`, {
			headers: {
				'PRIVATE-TOKEN': token,
				'User-Agent': 'DepShield/1.0',
			},
		});

		if (!mainRes.ok) {
			return { error: 'Failed to fetch project details' };
		}

		const project = (await mainRes.json()) as any;
		const defaultBranch = project.default_branch || 'main';

		const branchInfoRes = await fetch(`https://gitlab.com/api/v4/projects/${projectId}/repository/branches/${defaultBranch}`, {
			headers: { 'PRIVATE-TOKEN': token, 'User-Agent': 'DepShield/1.0' },
		});
		if (!branchInfoRes.ok) {
			const err = await branchInfoRes.text();
			logger.error('Failed to fetch GitLab branch info', { error: err, status: branchInfoRes.status });
			return { error: `Failed to fetch branch info: ${branchInfoRes.status}` };
		}
		const branchInfo = (await branchInfoRes.json()) as any;
		const mainSha = branchInfo.commit.id;

		const createBranchRes = await fetch(`https://gitlab.com/api/v4/projects/${projectId}/repository/branches`, {
			method: 'POST',
			headers: {
				'PRIVATE-TOKEN': token,
				'Content-Type': 'application/json',
				'User-Agent': 'DepShield/1.0',
			},
			body: JSON.stringify({
				branch: branchName,
				ref: defaultBranch,
			}),
		});

		let branchAlreadyExisted = false;

		if (!createBranchRes.ok) {
			const errText = await createBranchRes.text();
			let errData: any = {};
			try {
				errData = JSON.parse(errText);
			} catch {}

			if (createBranchRes.status === 422 || errData.message?.includes('already exists')) {
				branchAlreadyExisted = true;
				logger.warn('Branch already exists, reusing', { branchName });
			} else {
				logger.error('Failed to create GitLab branch', { error: errText });
				return { error: 'Failed to create branch' };
			}
		}

		logger.info('GitLab branch created', { branchName });

		const manifestRef = branchAlreadyExisted ? branchName : defaultBranch;

		const fileRes = await fetch(
			`https://gitlab.com/api/v4/projects/${projectId}/repository/files/${encodeURIComponent(manifestPath)}?ref=${manifestRef}`,
			{
				headers: {
					'PRIVATE-TOKEN': token,
					'User-Agent': 'DepShield/1.0',
				},
			},
		);

		const gcpToken = env.GCP_SERVICE_ACCOUNT ? await getGoogleAccessToken(env.GCP_SERVICE_ACCOUNT).catch(() => undefined) : undefined;
		if (fileRes.ok) {
			const fileData = (await fileRes.json()) as any;
			let manifestContent = Buffer.from(fileData.content, 'base64').toString('utf-8');

			const targetVersion = await resolveTargetVersion(from_pkg, to_pkg, manifestContent, ecosystem, env, gcpToken);

			let content = manifestContent.replace(new RegExp(`"${from_pkg}":\\s*"[^"]*"`, 'g'), `"${to_pkg}": "${targetVersion}"`);

			const commitRes = await fetch(`https://gitlab.com/api/v4/projects/${projectId}/repository/commits`, {
				method: 'POST',
				headers: {
					'PRIVATE-TOKEN': token,
					'Content-Type': 'application/json',
					'User-Agent': 'DepShield/1.0',
				},
				body: JSON.stringify({
					branch: branchName,
					commit_message: `chore: migrate ${from_pkg} to ${to_pkg}`,
					actions: [
						{
							action: 'update',
							file_path: manifestPath,
							content,
						},
					],
				}),
			});

			if (!commitRes.ok) {
				const err = await commitRes.text();
				logger.warn('Failed to commit changes', { error: err });
			} else {
				logger.info('Changes committed to GitLab', { branchName });
			}

			await searchAndTransformImports(
				'',
				'',
				from_pkg,
				to_pkg,
				branchName,
				defaultBranch,
				token,
				true,
				ecosystem,
				manifestPath,
				env,
				gcpToken,
				projectId,
			);
		}

		const communityContext = await getCommunityMigrationContext(from_pkg, env).catch(() => null);
		const communityLine = communityContext
			? communityContext?.migrationCount > 0
				? `\n> 💡 **Community insight:** ${communityContext.migrationCount} other projects have migrated from \`${from_pkg}\` to \`${communityContext.topAlternative}\` based on DepShield community data.\n`
				: ''
			: '';

		const mrRes = await fetch(`https://gitlab.com/api/v4/projects/${projectId}/merge_requests`, {
			method: 'POST',
			headers: {
				'PRIVATE-TOKEN': token,
				'Content-Type': 'application/json',
				'User-Agent': 'DepShield/1.0',
			},
			body: JSON.stringify({
				source_branch: branchName,
				target_branch: defaultBranch,
				title: `chore: migrate ${from_pkg} to ${to_pkg}`,
				description: `## Dependency Migration

**Package:** ${from_pkg} → ${to_pkg}

### What Changed
- Replaced \`${from_pkg}\` with \`${to_pkg}\` in package.json
- Updated all imports in source files

### Why This Change
${communityLine ?? ''}
- \`${from_pkg}\` is deprecated/unmaintained
- \`${to_pkg}\` is the recommended community replacement
- Reduces security vulnerabilities
- Better performance and active maintenance

### Testing
- [ ] Run \`npm install\`
- [ ] Run test suite: \`npm test\`
- [ ] Verify builds: \`npm run build\`
- [ ] Check functionality in dev environment

### Migration Notes
API compatibility: Most APIs are drop-in replacements. Refer to migration guide.

### Checklist
- [x] Code changes made
- [ ] Tests passing
- [ ] Documentation updated
- [ ] Ready for review

---
*This MR was automatically created by DepShield agent.*`,
				labels: ['dependencies', 'automated'],
				draft: false,
			}),
		});

		if (!mrRes.ok) {
			const errText = await mrRes.text();
			const existingMrRes = await fetch(
				`https://gitlab.com/api/v4/projects/${projectId}/merge_requests?source_branch=${branchName}&state=opened`,
				{
					headers: { 'PRIVATE-TOKEN': token, 'User-Agent': 'DepShield/1.0' },
				},
			);
			if (existingMrRes.ok) {
				const existingMrs = (await existingMrRes.json()) as any[];
				if (existingMrs.length > 0) {
					const mr = existingMrs[0];
					logger.info('MR already exists, returning existing', { mrUrl: mr.web_url });
					return {
						mr_url: mr.web_url,
						mr_id: mr.iid,
						branch_name: branchName,
						status: 'existing',
						message: `Existing MR: ${mr.web_url}`,
					};
				}
			}
			logger.error('Failed to create MR', { error: errText });
			return { error: 'Failed to create MR' };
		}

		const mr = (await mrRes.json()) as any;

		logger.info('GitLab MR created', { mrUrl: mr.web_url });

		return {
			mr_url: mr.web_url,
			mr_id: mr.iid,
			branch_name: branchName,
			status: 'created',
			message: `MR created: ${mr.web_url}`,
		};
	} catch (err) {
		logger.error('createGitLabMR failed', err, { from_pkg, to_pkg });
		return { error: err instanceof Error ? err.message : 'Unknown error' };
	}
};

export const checkGitHubCI = async (prUrl: string, env: CloudflareEnv): Promise<any> => {
	logger.info('checkGitHubCI called', { prUrl });

	try {
		const match = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
		if (!match) {
			return { error: 'Invalid GitHub PR URL' };
		}

		const [, owner, repo, prNumber] = match;

		const prRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`, {
			headers: {
				Authorization: `Bearer ${env.GITHUB_TOKEN}`,
				Accept: 'application/vnd.github.v3+json',
				'User-Agent': 'DepShield/1.0',
			},
		});

		if (!prRes.ok) {
			return { error: 'Failed to fetch PR' };
		}

		const pr = (await prRes.json()) as any;

		const checksRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${pr.head.sha}/check-runs`, {
			headers: {
				Authorization: `Bearer ${env.GITHUB_TOKEN}`,
				Accept: 'application/vnd.github.checks-preview+json',
				'User-Agent': 'DepShield/1.0',
			},
		});

		let checkStatus = 'pending';
		let checkSummary = 'No checks found';

		if (checksRes.ok) {
			const checks = (await checksRes.json()) as any;
			if (checks.check_runs.length > 0) {
				const allChecks = checks.check_runs;
				const passedCount = allChecks.filter((c: any) => c.conclusion === 'success').length;
				const failedCount = allChecks.filter((c: any) => c.conclusion === 'failure').length;

				if (failedCount > 0) {
					checkStatus = 'failed';
					checkSummary = `${failedCount} checks failed`;
				} else if (passedCount === allChecks.length) {
					checkStatus = 'success';
					checkSummary = `All ${passedCount} checks passed`;
				} else {
					checkStatus = 'pending';
					checkSummary = `${passedCount}/${allChecks.length} checks passed`;
				}
			}
		}

		return {
			ci_status: checkStatus,
			can_merge: pr.mergeable && checkStatus === 'success',
			pr_state: pr.state,
			checks_summary: checkSummary,
			message: `PR #${prNumber}: ${checkSummary}`,
		};
	} catch (err) {
		logger.error('checkGitHubCI failed', err);
		return { error: err instanceof Error ? err.message : 'Unknown error' };
	}
};

export const checkGitLabCI = async (mrUrl: string, env: CloudflareEnv): Promise<any> => {
	logger.info('checkGitLabCI called', { mrUrl });

	try {
		const match = mrUrl.match(/gitlab\.com\/(.+)\/-\/merge_requests\/(\d+)/);
		if (!match) {
			return { error: 'Invalid GitLab MR URL' };
		}

		const [, projectPath, mrId] = match;
		const projectId = encodeURIComponent(projectPath);

		const mrRes = await fetch(`https://gitlab.com/api/v4/projects/${projectId}/merge_requests/${mrId}`, {
			headers: {
				'PRIVATE-TOKEN': env.GITLAB_TOKEN,
			},
		});

		if (!mrRes.ok) {
			return { error: 'Failed to fetch MR' };
		}

		const mr = (await mrRes.json()) as any;

		let pipelineStatus = 'unknown';
		let pipelineSummary = 'No pipeline found';

		if (mr.head_pipeline) {
			pipelineStatus = mr.head_pipeline.status;
			const stages = mr.head_pipeline.details?.stages || [];
			const passedJobs = stages.filter((s: any) => s.status === 'success').length;
			const failedJobs = stages.filter((s: any) => s.status === 'failed').length;

			pipelineSummary = `Pipeline: ${passedJobs} passed, ${failedJobs} failed`;
		}

		return {
			ci_status: pipelineStatus,
			can_merge: mr.merge_when_pipeline_succeeds || (mr.state === 'merged_by_push' && pipelineStatus === 'success'),
			mr_state: mr.state,
			pipeline_summary: pipelineSummary,
			message: `MR !${mrId}: ${pipelineSummary}`,
		};
	} catch (err) {
		logger.error('checkGitLabCI failed', err);
		return { error: err instanceof Error ? err.message : 'Unknown error' };
	}
};

export const indexAlternative = async (
	input: { package_name: string; alternative_package: string; reason: string; ecosystem?: string },
	env: CloudflareEnv,
): Promise<any> => {
	const { package_name, alternative_package, reason, ecosystem = 'nodejs' } = input;
	logger.info('indexAlternative called', { package_name, alternative_package });

	try {
		const signal: PackageSignal = {
			package_name,
			ecosystem,
			signal_type: 'migration',
			signal_text: reason,
			source: 'migration-agent',
			date: new Date().toISOString(),
			sentiment_score: 0.5,
			alternatives: [alternative_package],
		};

		await indexPackageSignal(signal, env);
		logger.info('Alternative signal indexed by Agent', { package_name, alternative_package });
		return { success: true, message: `Alternative recorded for ${package_name}` };
	} catch (err) {
		logger.error('indexAlternative failed', err);
		return { success: false, error: err instanceof Error ? err.message : 'Failed to index' };
	}
};

const vertexFetchWithRetry = async (url: string, body: any, accessToken: string, retries = 3): Promise<Response | null> => {
	for (let attempt = 0; attempt <= retries; attempt++) {
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
			body: JSON.stringify(body),
		});

		if (res.ok) return res;

		if (res.status === 429 && attempt < retries) {
			const delay = 1000 * Math.pow(2, attempt);
			logger.warn('Vertex AI rate limited, retrying', { attempt, delayMs: delay, file: body.file_path });
			await new Promise((r) => setTimeout(r, delay));
			continue;
		}

		const errBody = await res.text();
		logger.warn('AI transform failed', { status: res.status, error: errBody });
		return null;
	}
	return null;
};

export const transformFileWithAI = async (
	input: {
		file_path: string;
		file_content: string;
		from_pkg: string;
		to_pkg: string;
		ecosystem: string;
	},
	env: CloudflareEnv,
	preFetchedtoken?: string,
): Promise<{ transformed: string; changed: boolean }> => {
	const { file_path, file_content, from_pkg, to_pkg, ecosystem } = input;

	if (!env.GCP_SERVICE_ACCOUNT || !env.GOOGLE_CLOUD_PROJECT_ID) {
		return { transformed: file_content, changed: false };
	}

	try {
		const accessToken = preFetchedtoken ?? (await getGoogleAccessToken(env.GCP_SERVICE_ACCOUNT));
		const projectId = env.GOOGLE_CLOUD_PROJECT_ID;
		const url = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent`;

		const prompt = `You are a code migration expert. Migrate all usage of "${from_pkg}" to "${to_pkg}" in this ${ecosystem} file.

Rules:
- Update import/require statements
- Update API calls to match the new package's API
- Preserve all existing logic and functionality
- Only change what is necessary for the migration
- If the file does not use ${from_pkg} at all, return the file unchanged
- Return ONLY the migrated file content, no explanations, no markdown fences

File: ${file_path}
Content:
${file_content}`;

		const res = await vertexFetchWithRetry(
			url,
			{
				contents: [{ role: 'user', parts: [{ text: prompt }] }],
				generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
			},
			accessToken,
		);

		if (!res) return { transformed: file_content, changed: false };

		const data = (await res.json()) as any;
		const transformed = data.candidates?.[0]?.content?.parts?.[0]?.text ?? file_content;
		const changed = transformed.trim() !== file_content.trim();

		logger.info('AI transform complete', { file: file_path, changed });
		return { transformed, changed };
	} catch (err) {
		logger.error('transformFileWithAI failed', err, { file: file_path });
		return { transformed: file_content, changed: false };
	}
};
