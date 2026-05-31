import { Ecosystem, PackageManager } from '@/types';

export const ECOSYSTEM_FILES: Array<{
	files: string[];
	ecosystem: Ecosystem;
	supported: boolean;
}> = [
	{ files: ['package.json'], ecosystem: 'nodejs', supported: true },
	{ files: ['requirements.txt', 'pyproject.toml'], ecosystem: 'python', supported: false },
	{ files: ['go.mod'], ecosystem: 'go', supported: false },
	{ files: ['pom.xml', 'build.gradle'], ecosystem: 'java', supported: false },
	{ files: ['Gemfile'], ecosystem: 'ruby', supported: false },
	{ files: ['composer.json'], ecosystem: 'php', supported: false },
	{ files: ['Cargo.toml'], ecosystem: 'rust', supported: false },
];

export const PACKAGE_MANAGER_FILES: Array<{
	file: string;
	manager: PackageManager;
}> = [
	{ file: 'bun.lockb', manager: 'bun' },
	{ file: 'pnpm-lock.yaml', manager: 'pnpm' },
	{ file: 'yarn.lock', manager: 'yarn' },
	{ file: 'package-lock.json', manager: 'npm' },
];

export const DEPENDENCY_FILES: Record<Ecosystem, string> = {
	nodejs: 'package.json',
	python: 'requirements.txt',
	go: 'go.mod',
	java: 'pom.xml',
	ruby: 'Gemfile',
	php: 'composer.json',
	rust: 'Cargo.toml',
};

export const COMMON_SUBDIRS = ['backend', 'frontend', 'server', 'client', 'app', 'src', 'api', 'web'];
