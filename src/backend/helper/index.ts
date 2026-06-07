import { Ecosystem } from '@/types';

// Pre-compiled global regexes to save compilation CPU overhead inside functions
const PYTHON_LINE_REGEX = /^([a-zA-Z0-9_-]+)([>=<!]=?.*)?$/;
const GRADLE_SHORT_REGEX = /(?:implementation|api|compile|runtimeOnly|testImplementation|testCompile)\s+['"]([^'"]+)['"]/g;
const GRADLE_LONG_REGEX =
	/(?:implementation|api|compile|testImplementation)\s+group:\s*['"]([^'"]+)['"]\s*,\s*name:\s*['"]([^'"]+)['"]\s*,\s*version:\s*['"]([^'"]+)['"]/g;
const GRADLE_KOTLIN_REGEX = /(?:implementation|api|compile|runtimeOnly|testImplementation)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const MAVEN_DEP_REGEX = /<dependency>([\s\S]*?)<\/dependency>/g;
const MAVEN_GROUP_REGEX = /<groupId>(.*?)<\/groupId>/;
const MAVEN_ARTIFACT_REGEX = /<artifactId>(.*?)<\/artifactId>/;
const MAVEN_VERSION_REGEX = /<version>(.*?)<\/version>/;
const GO_SINGLE_REGEX = /^require\s+(\S+)\s+(\S+)/;
const GO_BLOCK_REGEX = /^(\S+)\s+(\S+)/;

// Helper function to safely slice off trailing .git cleanly
const stripTrailingGit = (str?: string): string => {
	if (!str) return '';
	return str.endsWith('.git') ? str.slice(0, -4) : str;
};

export const parseGithubUrl = (repoUrl: string) => {
	const url = new URL(repoUrl);
	const [, owner, repo] = url.pathname.split('/');
	return { owner, repo: stripTrailingGit(repo) };
};

export const parseGitlabUrl = (repoUrl: string) => {
	const url = new URL(repoUrl);
	const parts = url.pathname.split('/').filter(Boolean);
	return {
		owner: parts[0],
		repo: stripTrailingGit(parts[1]),
		fullPath: parts.join('/'),
	};
};

export const parseByEcosystem = (ecosystem: Ecosystem, content: string, fileName?: string): Record<string, string> => {
	switch (ecosystem) {
		case 'nodejs':
			return parsePackageJson(content);
		case 'python':
			return parseRequirementsTxt(content);
		case 'java':
			return fileName === 'build.gradle' ? parseBuildGradle(content) : parsePomXml(content);
		case 'go':
			return parseGoMod(content);
		default:
			return {};
	}
};

export const parsePackageJson = (content: string): Record<string, string> => {
	const json = JSON.parse(content);
	return {
		...json.dependencies,
		...json.devDependencies,
	};
};

export const parseRequirementsTxt = (content: string): Record<string, string> => {
	const deps: Record<string, string> = {};
	const lines = content.split('\n');

	for (let i = 0; i < lines.length; i++) {
		const trimmed = lines[i].trim();
		if (!trimmed || trimmed[0] === '#') continue; // Faster character lookup than startsWith

		const match = trimmed.match(PYTHON_LINE_REGEX);
		if (match) {
			deps[match[1]] = match[2] ? match[2].trim() : '*';
		}
	}

	return deps;
};

export const parseBuildGradle = (content: string): Record<string, string> => {
	const deps: Record<string, string> = {};
	let match;

	// Reset global regex indices
	GRADLE_SHORT_REGEX.lastIndex = 0;
	GRADLE_LONG_REGEX.lastIndex = 0;
	GRADLE_KOTLIN_REGEX.lastIndex = 0;

	while ((match = GRADLE_SHORT_REGEX.exec(content)) !== null) {
		const parts = match[1].split(':');
		if (parts.length >= 2) {
			deps[`${parts[0]}:${parts[1]}`] = parts[2] ?? 'unknown';
		}
	}

	while ((match = GRADLE_LONG_REGEX.exec(content)) !== null) {
		deps[`${match[1]}:${match[2]}`] = match[3];
	}

	while ((match = GRADLE_KOTLIN_REGEX.exec(content)) !== null) {
		const parts = match[1].split(':');
		if (parts.length >= 2) {
			deps[`${parts[0]}:${parts[1]}`] = parts[2] ?? 'unknown';
		}
	}

	return deps;
};

export const parsePomXml = (content: string): Record<string, string> => {
	const deps: Record<string, string> = {};
	let match;

	MAVEN_DEP_REGEX.lastIndex = 0;

	while ((match = MAVEN_DEP_REGEX.exec(content)) !== null) {
		const block = match[1];
		const groupId = block.match(MAVEN_GROUP_REGEX)?.[1];
		const artifactId = block.match(MAVEN_ARTIFACT_REGEX)?.[1];
		const version = block.match(MAVEN_VERSION_REGEX)?.[1] ?? 'unknown';

		if (groupId && artifactId) {
			deps[`${groupId}:${artifactId}`] = version;
		}
	}

	return deps;
};

export const parseGoMod = (content: string): Record<string, string> => {
	const deps: Record<string, string> = {};
	const lines = content.split('\n');
	let inRequire = false;

	for (let i = 0; i < lines.length; i++) {
		const trimmed = lines[i].trim();

		if (trimmed === 'require (') {
			inRequire = true;
			continue;
		}
		if (trimmed === ')' && inRequire) {
			inRequire = false;
			continue;
		}

		const singleMatch = trimmed.match(GO_SINGLE_REGEX);
		if (singleMatch) {
			deps[singleMatch[1]] = singleMatch[2];
			continue;
		}

		if (inRequire) {
			const blockMatch = trimmed.match(GO_BLOCK_REGEX);
			if (blockMatch && blockMatch[1][0] !== '/' && blockMatch[1][1] !== '/') {
				deps[blockMatch[1]] = blockMatch[2];
			}
		}
	}

	return deps;
};

export const formatDate = (date: Date): string => date.toISOString().split('T')[0];
