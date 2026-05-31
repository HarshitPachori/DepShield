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

export const parseByEcosystem = (ecosystem: Ecosystem, content: string): Record<string, string> => {
	switch (ecosystem) {
		case 'nodejs':
			return parsePackageJson(content);
		case 'python':
			return parseRequirementsTxt(content);
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
