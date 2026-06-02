import { Ecosystem } from '@/types';

export const parseGithubUrl = (repoUrl: string) => {
	const url = new URL(repoUrl);
	const [, owner, repo] = url.pathname.split('/');
	return { owner, repo: repo?.replace('.git', '') };
};

export const parseGitlabUrl = (repoUrl: string) => {
	const url = new URL(repoUrl);
	const parts = url.pathname.split('/').filter(Boolean);
	return {
		owner: parts[0],
		repo: parts[1]?.replace('.git', ''),
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

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const match = trimmed.match(/^([a-zA-Z0-9_-]+)([>=<!]=?.*)?$/);
		if (match) {
			deps[match[1]] = match[2]?.trim() ?? '*';
		}
	}

	return deps;
};

export const parseBuildGradle = (content: string): Record<string, string> => {
	const deps: Record<string, string> = {};

	// Gradle patterns:
	// implementation 'org.springframework.boot:spring-boot-starter:3.0.0'
	// implementation "com.google.guava:guava:31.0-jre"
	// implementation group: 'org.apache.commons', name: 'commons-lang3', version: '3.12.0'

	const shortRegex = /(?:implementation|api|compile|runtimeOnly|testImplementation)['"]\s*['"]([^'"]+)['"]['"]/g;
	let match;

	while ((match = shortRegex.exec(content)) !== null) {
		const parts = match[1].split(':');
		if (parts.length >= 2) {
			const name = `${parts[0]}:${parts[1]}`;
			const version = parts[2] ?? 'unknown';
			deps[name] = version;
		}
	}

	const longRegex =
		/(?:implementation|api|compile)\s+group:\s*['"]([^'"]+)['"]\s*,\s*name:\s*['"]([^'"]+)['"]\s*,\s*version:\s*['"]([^'"]+)['"]/g;

	while ((match = longRegex.exec(content)) !== null) {
		deps[`${match[1]}:${match[2]}`] = match[3];
	}

	return deps;
};

export const parsePomXml = (content: string): Record<string, string> => {
	const deps: Record<string, string> = {};

	// Maven dependency pattern:
	// <groupId>org.springframework</groupId>
	// <artifactId>spring-core</artifactId>
	// <version>5.3.21</version>
	const depRegex = /<dependency>([\s\S]*?)<\/dependency>/g;
	let match;

	while ((match = depRegex.exec(content)) !== null) {
		const block = match[1];
		const groupId = block.match(/<groupId>(.*?)<\/groupId>/)?.[1];
		const artifactId = block.match(/<artifactId>(.*?)<\/artifactId>/)?.[1];
		const version = block.match(/<version>(.*?)<\/version>/)?.[1] ?? 'unknown';

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

	for (const line of lines) {
		const trimmed = line.trim();

		if (trimmed === 'require (') {
			inRequire = true;
			continue;
		}
		if (trimmed === ')' && inRequire) {
			inRequire = false;
			continue;
		}

		// Single line require: require github.com/gin-gonic/gin v1.9.0
		const singleMatch = trimmed.match(/^require\s+(\S+)\s+(\S+)/);
		if (singleMatch) {
			deps[singleMatch[1]] = singleMatch[2];
			continue;
		}

		// Inside require block: github.com/gin-gonic/gin v1.9.0
		if (inRequire) {
			const blockMatch = trimmed.match(/^(\S+)\s+(\S+)/);
			if (blockMatch && !blockMatch[1].startsWith('//')) {
				deps[blockMatch[1]] = blockMatch[2];
			}
		}
	}

	return deps;
};

export const formatDate = (date: Date): string => date.toISOString().split('T')[0];
