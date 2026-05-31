export type Platform = 'github' | 'gitlab';

export type Ecosystem = 'nodejs' | 'python' | 'go' | 'java' | 'ruby' | 'php' | 'rust';

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export type RiskLevel = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'SAFE';

export type FixStrategy = 'migrate' | 'version_bump' | 'monitor';

export type ScanStatus = 'pending' | 'scanning' | 'complete' | 'error';

export type MigrationStatus =
	| 'pending'
	| 'analyzing'
	| 'branching'
	| 'transforming'
	| 'committing'
	| 'ci_running'
	| 'creating_mr'
	| 'complete'
	| 'error';

export interface CVE {
	id: string;
	severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
	affectedVersions: string[];
	fixedVersion?: string;
	description: string;
}

export interface RiskSignals {
	isDeprecated: boolean;
	lastCommitDaysAgo: number;
	downloadTrendPercent: number;
	openCveCount: number;
	maintainerActive: boolean;
	weeklyDownloads: number;
	communitySignal?: string;
}

export interface PackageRisk {
	name: string;
	declaredVersion: string;
	installedVersion?: string;
	ecosystem: Ecosystem;
	riskScore: number;
	riskLevel: RiskLevel;
	fixStrategy: FixStrategy;
	signals: RiskSignals;
	explanation: string;
	recommendation?: string;
	alternative?: string;
	alternativeCompatibility?: number;
	cves: CVE[];
}

export interface EcosystemDetection {
	ecosystem: Ecosystem | null;
	packageManager: PackageManager | null;
	dependencyFile: string | null;
	lockFile: string | null;
	supported: boolean;
}

export interface AffectedFile {
	path: string;
	linesChanged: number;
	patterns: string[];
}

export interface CodePreview {
	file: string;
	before: string;
	after: string;
}

export interface SimulationResult {
	simulationId: string;
	fromPackage: string;
	toPackage: string;
	filesAffected: AffectedFile[];
	breakingChanges: string[];
	effortHours: number;
	confidence: number;
	codePreview: CodePreview;
}

export interface MigrationStep {
	step: string;
	status: 'pending' | 'running' | 'complete' | 'error';
	message?: string;
	timestamp?: number;
}

export interface MigrationResult {
	migrationId: string;
	status: MigrationStatus;
	steps: MigrationStep[];
	mrUrl?: string;
	prUrl?: string;
	branchName?: string;
	filesChanged?: number;
	ciStatus?: 'passing' | 'failing' | 'running';
	error?: string;
}

export interface ScanRequest {
	repoUrl: string;
	token?: string;
}

export interface ScanResponse {
	jobId: string;
	status: ScanStatus;
	repoUrl: string;
	platform: Platform;
	ecosystem: Ecosystem | null;
}

export interface StatusResponse {
	jobId: string;
	status: ScanStatus;
	progress: number;
	total: number;
	ecosystem: Ecosystem | null;
	packageManager: PackageManager | null;
	results?: PackageRisk[];
	error?: string;
}

export interface SimulateRequest {
	jobId: string;
	packageName: string;
	repoUrl: string;
	token?: string;
}

export interface MigrateRequest {
	jobId: string;
	packageName: string;
	repoUrl: string;
	platform: Platform;
	token: string;
}
