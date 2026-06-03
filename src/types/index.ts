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
	riskScore?: number;
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
	alternativeReason?: string;
	cves: CVE[];
}

export interface EcosystemDetection {
	ecosystem: Ecosystem | null;
	packageManager: PackageManager | null;
	dependencyFile: string | null;
	lockFile: string | null;
	supported: boolean;
	basePath: string;
	allDetected: Array<{
		ecosystem: Ecosystem;
		supported: boolean;
		basePath: string;
	}>;
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
	status: 'pending' | 'scanning' | 'complete' | 'error';
	progress: number;
	total: number;
	repoUrl: string;
	platform: 'github' | 'gitlab';
	ecosystem?: string;
	packageManager?: string;
	basePath?: string;
	allDetected?: Array<{ ecosystem: string; supported: boolean; basePath: string }>;
	summary?: {
		totalPackages: number;
		criticalCount: number;
		highCount: number;
		mediumCount: number;
		lowCount: number;
		safeCount: number;
	};
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

export interface NpmPackageInfo {
	name: string;
	version: string;
	isDeprecated: boolean;
	deprecationMessage?: string;
	lastPublishedAt: string;
	lastPublishedDaysAgo: number;
	weeklyDownloads: number;
	maintainerCount: number;
	license?: string;
	homepage?: string;
	repository?: string;
}

export interface NpmDownloadStats {
	weeklyDownloads: number;
	monthlyDownloads: number;
	trendPercent: number; // positive = growing, negative = declining
}

export interface ApiResponse<T = unknown> {
	success: boolean;
	message: string;
	data?: T;
	timestamp: string;
}

export interface ApiError {
	success: false;
	message: string;
	statusCode: number;
	details?: unknown;
	timestamp: string;
}
