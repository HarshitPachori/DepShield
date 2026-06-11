'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { ApiResponse, PackageRisk, StatusResponse } from '@/types';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';

const RISK_COLORS: Record<string, string> = {
	CRITICAL: 'text-[var(--risk-critical)]',
	HIGH: 'text-[var(--risk-high)]',
	MEDIUM: 'text-[var(--risk-medium)]',
	LOW: 'text-[var(--risk-low)]',
	SAFE: 'text-[var(--risk-safe)]',
};

const RISK_BG: Record<string, string> = {
	CRITICAL: 'bg-[var(--risk-critical)]/10 border-[var(--risk-critical)]/30',
	HIGH: 'bg-[var(--risk-high)]/10 border-[var(--risk-high)]/30',
	MEDIUM: 'bg-[var(--risk-medium)]/10 border-[var(--risk-medium)]/30',
	LOW: 'bg-[var(--risk-low)]/10 border-[var(--risk-low)]/30',
	SAFE: 'bg-[var(--risk-safe)]/10 border-[var(--risk-safe)]/30',
};

const RISK_DOT: Record<string, string> = {
	CRITICAL: 'bg-[var(--risk-critical)]',
	HIGH: 'bg-[var(--risk-high)]',
	MEDIUM: 'bg-[var(--risk-medium)]',
	LOW: 'bg-[var(--risk-low)]',
	SAFE: 'bg-[var(--risk-safe)]',
};

interface LeaderboardItem {
	package: string;
	appearances: number;
	avg_risk_score: number;
	affected_repos: number;
}

const isTemplateExplanation = (explanation: string) =>
	/is (critical|high|medium|low|safe) risk:/.test(explanation) || explanation.includes('appears healthy');

function DashboardPageComponent() {
	const searchParams = useSearchParams();
	const router = useRouter();
	const jobId = searchParams.get('jobId');

	const [job, setJob] = useState<StatusResponse | null>(null);
	const [filter, setFilter] = useState<string>('ALL');
	const [loading, setLoading] = useState(true);
	const [isEnriching, setIsEnriching] = useState(false);
	const [isAgentRunning, setIsAgentRunning] = useState(false);
	const [leaderboard, setLeaderboard] = useState<any[]>([]);

	const [migrating, setMigrating] = useState<string | null>(null);

	const handleMigrate = async (packageName: string) => {
		if (!jobId || !job) return;
		setMigrating(packageName);
		try {
			await fetch(`/api/migrate/${jobId}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ packageName, repoUrl: job.repoUrl, platform: job.platform }),
			});
			const deadline = Date.now() + 120000;
			const interval = setInterval(async () => {
				const updated = await fetchJob();
				const pkg = updated?.results?.find((r) => r.name === packageName);
				if (pkg?.agentPR || !updated?.prPending?.includes(packageName) || Date.now() > deadline) {
					setMigrating(null);
					clearInterval(interval);
				}
			}, 3000);
		} catch {
			setMigrating(null);
		}
	};

	const fetchJob = useCallback(async () => {
		if (!jobId) return;
		const res = await fetch(`/api/status/${jobId}`);
		const data: ApiResponse<StatusResponse> = await res.json();
		if (data.success && data.data) {
			setJob(data.data);
			return data.data;
		}
		return null;
	}, [jobId]);

	useEffect(() => {
		if (!jobId) {
			router.replace('/');
			return;
		}
		fetchJob().finally(() => setLoading(false));
		fetch('/api/elastic/leaderboard')
			.then((r) => r.json() as Promise<{ success: boolean; data: { data: LeaderboardItem[] } }>)
			.then((d) => {
				if (d.success) setLeaderboard(d.data.data ?? []);
			})
			.catch(() => {});
	}, [jobId, router, fetchJob]);

	useEffect(() => {
		if (!job || job.status !== 'complete') return;
		const results = job.results ?? [];
		const highRisk = results.filter((r) => r.riskLevel === 'CRITICAL' || r.riskLevel === 'HIGH' || r.riskLevel === 'MEDIUM');
		const hasAI = highRisk.some((r) => r.explanation && !isTemplateExplanation(r.explanation));
		if (highRisk.length > 0 && !hasAI) {
			setIsEnriching(true);
		}
	}, [job]);

	useEffect(() => {
		if (!job || job.status !== 'complete') return;
		if (job.aiEnriching && !job.aiEnriched) {
			setIsEnriching(true);
		} else if (job.aiEnriched) {
			setIsEnriching(false);
			if (!job.agentComplete) setIsAgentRunning(true);
		}
	}, [job?.aiEnriching, job?.aiEnriched, job?.agentComplete]);

	useEffect(() => {
		if (!isEnriching) return;

		const interval = setInterval(async () => {
			const updated = await fetchJob();
			if (!updated) return;

			if (updated.aiEnriched) {
				setIsEnriching(false);
				clearInterval(interval);
				if (!updated.agentComplete) setIsAgentRunning(true);
			}
		}, 3000);

		return () => clearInterval(interval);
	}, [isEnriching, fetchJob]);

	useEffect(() => {
		if (!isAgentRunning) return;
		const deadline = Date.now() + 120000;

		const interval = setInterval(async () => {
			const updated = await fetchJob();
			if (!updated) return;

			if (updated.agentComplete || Date.now() > deadline) {
				setIsAgentRunning(false);
				clearInterval(interval);
			}
		}, 3000);

		return () => clearInterval(interval);
	}, [isAgentRunning, fetchJob]);

	if (loading) {
		return (
			<div className="min-h-screen flex items-center justify-center">
				<div className="text-muted-foreground text-sm">Loading results...</div>
			</div>
		);
	}

	if (!job || job.status !== 'complete') {
		return (
			<div className="min-h-screen flex items-center justify-center">
				<div className="text-center">
					<p className="text-muted-foreground text-sm mb-4">No results found.</p>
					<Button variant="outline" className="cursor-pointer" onClick={() => router.push('/')}>
						New Scan
					</Button>
				</div>
			</div>
		);
	}

	const results = job.results ?? [];
	const summary = job.summary;

	const filtered = filter === 'ALL' ? results : results.filter((p) => p.riskLevel === filter);

	const filterOptions = [
		{ label: 'All', value: 'ALL', count: results.length },
		{ label: 'Critical', value: 'CRITICAL', count: summary?.criticalCount ?? 0 },
		{ label: 'High', value: 'HIGH', count: summary?.highCount ?? 0 },
		{ label: 'Medium', value: 'MEDIUM', count: summary?.mediumCount ?? 0 },
		{ label: 'Low', value: 'LOW', count: summary?.lowCount ?? 0 },
		{ label: 'Safe', value: 'SAFE', count: summary?.safeCount ?? 0 },
	];

	return (
		<div className="min-h-screen px-4 sm:px-6 py-8">
			<div className="max-w-5xl mx-auto">
				{/* Header */}
				<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
					<div>
						<h1 className="text-2xl font-bold text-foreground">Scan Results</h1>
						<Link
							href={job.repoUrl}
							target="_blank"
							rel="noopener noreferrer"
							className="text-muted-foreground text-sm mt-1 max-w-md md:max-w-full hover:underline block"
						>
							{job.repoUrl}
						</Link>
					</div>
					<div className="flex items-center gap-2">
						<Badge variant="outline" className="text-xs border-border text-muted-foreground">
							{job.platform}
						</Badge>
						{job.packageManager && (
							<Badge variant="outline" className="text-xs border-border text-muted-foreground">
								{job.packageManager}
							</Badge>
						)}
						<Button variant="outline" size="sm" onClick={() => router.push('/')}>
							New Scan
						</Button>
					</div>
				</div>

				{/* AI Enriching Banner */}
				{isEnriching && (
					<div className="flex items-center gap-2 bg-primary/5 border border-primary/20 rounded-lg px-4 py-2.5 mb-5">
						<div className="w-2 h-2 rounded-full bg-primary animate-pulse shrink-0" />
						<p className="text-xs text-muted-foreground">
							AI is analyzing high-risk packages. Explanations and alternatives will update automatically.
						</p>
					</div>
				)}

				{/* Agent Analyzing Banner */}
				{isAgentRunning && (
					<div className="flex items-center gap-2 bg-primary/5 border border-primary/20 rounded-lg px-4 py-2.5 mb-5">
						<div className="w-2 h-2 rounded-full bg-primary animate-pulse shrink-0" />
						<p className="text-xs text-muted-foreground">Agent is analyzing packages for migration opportunities...</p>
					</div>
				)}

				{/* Agent Analysis Complete Banner */}
				{job.agentAnalysisDone && !isAgentRunning && (
					<div className="flex items-center gap-2 bg-green-500/5 border border-green-500/20 rounded-lg px-4 py-2.5 mb-5">
						<div className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
						<p className="text-xs text-muted-foreground">
							Agent analysis complete. Expand packages below to see migration recommendations.
						</p>
					</div>
				)}

				{/* Summary cards */}
				<div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
					{[
						{ label: 'Critical', count: summary?.criticalCount ?? 0, level: 'CRITICAL' },
						{ label: 'High', count: summary?.highCount ?? 0, level: 'HIGH' },
						{ label: 'Medium', count: summary?.mediumCount ?? 0, level: 'MEDIUM' },
						{ label: 'Low', count: summary?.lowCount ?? 0, level: 'LOW' },
						{ label: 'Safe', count: summary?.safeCount ?? 0, level: 'SAFE' },
					].map((s) => (
						<button
							key={s.level}
							onClick={() => setFilter(filter === s.level ? 'ALL' : s.level)}
							className={`bg-card border rounded-xl p-4 text-left transition-all hover:border-primary/20 cursor-pointer ${
								filter === s.level ? RISK_BG[s.level] : 'border-border'
							}`}
						>
							<p className={`text-xl font-bold ${RISK_COLORS[s.level]}`}>{s.count}</p>
							<p className="text-xs text-muted-foreground mt-1">{s.label}</p>
						</button>
					))}
				</div>

				{/* Filter tabs */}
				<div className="flex items-center gap-1 mb-4 flex-wrap">
					{filterOptions.map((f) => (
						<button
							key={f.value}
							onClick={() => setFilter(f.value)}
							className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
								filter === f.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
							}`}
						>
							{f.label}
							{f.count > 0 && <span className="ml-1.5 opacity-70">{f.count}</span>}
						</button>
					))}
				</div>

				{leaderboard.length > 0 && (
					<div className="bg-card border border-border rounded-xl p-5 mb-6">
						<div className="flex items-center gap-2 mb-4">
							<div className="w-2 h-2 rounded-full bg-primary" />
							<p className="text-sm font-semibold text-foreground">Community Risk Intelligence</p>
							<span className="text-xs text-muted-foreground ml-auto">Powered by Elastic</span>
						</div>
						<p className="text-xs text-muted-foreground mb-3">Most commonly risky packages seen across all DepShield scans</p>
						<div className="flex flex-wrap gap-2">
							{leaderboard.slice(0, 8).map((item: any) => (
								<div key={item.package} className="flex items-center gap-2 bg-muted/50 border border-border rounded-lg px-3 py-2">
									<span className="text-xs font-mono text-foreground">{item.package}</span>
									<span className="text-xs text-muted-foreground">
										{item.affected_repos} repo{item.affected_repos !== 1 ? 's' : ''}
									</span>
									<span
										className={`text-xs font-medium ${
											item.avg_risk_score >= 70 ? 'text-risk-critical' : item.avg_risk_score >= 45 ? 'text-risk-high' : 'text-risk-medium'
										}`}
									>
										{item.avg_risk_score}
									</span>
								</div>
							))}
						</div>
					</div>
				)}

				{/* Package list */}
				<div className="space-y-3">
					{filtered.length === 0 ? (
						<div className="bg-card border border-border rounded-xl p-8 text-center">
							<p className="text-muted-foreground text-sm">No packages in this category.</p>
						</div>
					) : (
						filtered.map((pkg) => (
							<PackageRow key={pkg.name} pkg={pkg} onMigrate={handleMigrate} migrating={migrating} prPending={job?.prPending ?? []} />
						))
					)}
				</div>
			</div>
		</div>
	);
}

export default function DashboardPage() {
	return (
		<Suspense
			fallback={
				<div className="min-h-screen flex items-center justify-center">
					<div className="text-muted-foreground text-sm">Loading dashboard...</div>
				</div>
			}
		>
			<DashboardPageComponent />
		</Suspense>
	);
}

function PackageRow({
	pkg,
	onMigrate,
	migrating,
	prPending = [],
}: {
	pkg: PackageRisk;
	onMigrate: (name: string) => void;
	migrating: string | null;
	prPending?: string[];
}) {
	const [expanded, setExpanded] = useState(false);
	const [showAllCves, setShowAllCves] = useState(false);
	const isPending = migrating === pkg.name || prPending.includes(pkg.name);

	const isAIExplanation = pkg.explanation && !isTemplateExplanation(pkg.explanation);

	return (
		<div className="bg-card border border-border rounded-xl overflow-hidden">
			<button
				onClick={() => setExpanded(!expanded)}
				className="w-full flex items-start gap-3 px-4 py-4 hover:bg-muted/30 transition-colors text-left cursor-pointer"
			>
				<div className={`w-2 h-2 rounded-full shrink-0 mt-1.25 ${RISK_DOT[pkg.riskLevel]}`} />
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2 mb-1">
						<span className="text-foreground text-sm font-semibold">{pkg.name}</span>
						<span className="text-muted-foreground text-xs">{pkg.declaredVersion}</span>
					</div>
					<p className={`text-muted-foreground text-xs leading-relaxed ${expanded ? '' : 'line-clamp-2'}`}>{pkg.explanation}</p>
				</div>
				<div className="flex items-center gap-2.5 shrink-0 ml-4">
					{pkg.cves.length > 0 && (
						<span className="text-xs text-muted-foreground hidden sm:block">
							{pkg.cves.length} CVE{pkg.cves.length > 1 ? 's' : ''}
						</span>
					)}
					<Badge variant="outline" className={`text-xs font-medium ${RISK_BG[pkg.riskLevel]} ${RISK_COLORS[pkg.riskLevel]}`}>
						{pkg.riskLevel}
					</Badge>
					<span className={`text-sm font-bold min-w-6 text-right ${RISK_COLORS[pkg.riskLevel]}`}>{pkg.riskScore}</span>
				</div>
			</button>

			{expanded && (
				<div className="border-t border-border px-5 py-5 bg-muted/10 space-y-4">
					{/* Signals grid */}
					<div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
						{[
							{ label: 'Deprecated', value: pkg.signals.isDeprecated ? 'Yes' : 'No', danger: pkg.signals.isDeprecated },
							{ label: 'Last commit', value: `${pkg.signals.lastCommitDaysAgo}d ago`, danger: pkg.signals.lastCommitDaysAgo > 180 },
							{
								label: 'Download trend',
								value: `${pkg.signals.downloadTrendPercent > 0 ? '+' : ''}${pkg.signals.downloadTrendPercent}%`,
								danger: pkg.signals.downloadTrendPercent < -25,
							},
							{ label: 'Weekly downloads', value: pkg.signals.weeklyDownloads.toLocaleString(), danger: false },
						].map((s) => (
							<div key={s.label} className="bg-card border border-border rounded-lg p-3">
								<p className="text-muted-foreground text-xs mb-1">{s.label}</p>
								<p className={`text-sm font-medium ${s.danger ? 'text-destructive' : 'text-foreground'}`}>{s.value}</p>
							</div>
						))}
					</div>

					{/* Strategy + AI indicator */}
					<div className="flex items-center gap-2 flex-wrap mb-3">
						<Badge variant="outline" className="text-xs border-border text-muted-foreground">
							Strategy: {pkg.fixStrategy}
						</Badge>
						{isAIExplanation && (
							<Badge variant="outline" className="text-xs border-primary/30 text-primary bg-primary/5">
								AI analyzed
							</Badge>
						)}
					</div>

					{/* Alternative */}
					{pkg.alternative && (
						<div className="bg-primary/5 border border-primary/20 rounded-lg p-4 mb-4">
							<p className="text-xs text-muted-foreground mb-1.5">Recommended alternative</p>
							<div className="flex items-start gap-2">
								<span className="text-sm font-semibold text-primary shrink-0">{pkg.alternative}</span>
								{pkg.alternativeReason && <p className="text-xs text-muted-foreground leading-relaxed">{pkg.alternativeReason}</p>}
							</div>
						</div>
					)}

					{/* CVEs */}
					{pkg.cves.length > 0 && (
						<div>
							<p className="text-xs text-muted-foreground mb-2">Vulnerabilities</p>
							<div className="space-y-1.5">
								{(showAllCves ? pkg.cves : pkg.cves.slice(0, 3)).map((cve) => (
									<div key={cve.id} className="flex items-start gap-2 text-xs">
										<Link
											href={`https://github.com/advisories/${cve.id}`}
											target="_blank"
											rel="noopener noreferrer"
											className={`shrink-0 font-mono hover:underline ${RISK_COLORS[cve.severity]}`}
										>
											{cve.id}
										</Link>
										<span className="text-muted-foreground">{cve.description}</span>
									</div>
								))}
								{pkg.cves.length > 3 && (
									<button onClick={() => setShowAllCves(!showAllCves)} className="text-primary text-xs hover:underline mt-1 cursor-pointer">
										{showAllCves ? 'Show less' : `+${pkg.cves.length - 3} more`}
									</button>
								)}
							</div>
						</div>
					)}

					{/* Agent Analysis */}
					{pkg.agentAnalysis && !pkg.agentPR && (
						<div className="bg-card border border-border rounded-lg p-4 mt-2">
							<p className="text-xs text-muted-foreground mb-2">Agent Analysis</p>
							<p className="text-xs text-foreground mb-3">{pkg.agentAnalysis.reason}</p>
							<div className="flex items-center gap-2 flex-wrap mb-3">
								<Badge variant="outline" className="text-xs">
									Confidence: {pkg.agentAnalysis.confidence}%
								</Badge>
								<Badge variant="outline" className="text-xs">
									Complexity: {pkg.agentAnalysis.complexity}
								</Badge>
								{pkg.agentAnalysis.breakingChanges && (
									<Badge variant="outline" className="text-xs border-yellow-500/30 text-yellow-600 bg-yellow-500/5">
										⚠ {pkg.agentAnalysis.breakingChanges}
									</Badge>
								)}
							</div>
							{pkg.agentAnalysis.migration_guide_url && (
								<Link
									href={pkg.agentAnalysis.migration_guide_url}
									target="_blank"
									rel="noopener noreferrer"
									className="text-xs text-primary hover:underline block mb-3"
								>
									Migration guide →
								</Link>
							)}

							{pkg.agentAnalysis.needsPR ? (
								<button
									onClick={(e) => {
										e.stopPropagation();
										onMigrate(pkg.name);
									}}
									disabled={isPending}
									className="px-3 py-1.5 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
								>
									{isPending ? 'Creating PR...' : `Migrate to ${pkg.agentAnalysis.recommendedAlternative} →`}
								</button>
							) : (
								<p className="text-xs text-green-600">No migration needed</p>
							)}
						</div>
					)}

					{/* Agent Migration */}
					{pkg.agentPR && (
						<div className="bg-green-500/5 border border-green-500/20 rounded-lg p-4 mt-4">
							<p className="text-xs text-muted-foreground mb-2">Agent Migration</p>
							<Link
								href={pkg.agentPR.url}
								target="_blank"
								rel="noopener noreferrer"
								className="flex items-center gap-2 text-xs text-green-600 hover:underline mb-2"
							>
								<span>
									PR #{pkg.agentPR.number}: {pkg.agentPR.title}
								</span>
								<span className="text-muted-foreground">→</span>
								<Badge
									variant="outline"
									className={`text-xs ${
										pkg.agentPR.ci_status === 'success'
											? 'border-green-500/30 text-green-600 bg-green-500/5'
											: pkg.agentPR.ci_status === 'failed'
												? 'border-red-500/30 text-red-600 bg-red-500/5'
												: 'border-yellow-500/30 text-yellow-600 bg-yellow-500/5'
									}`}
								>
									CI: {pkg.agentPR.ci_status}
								</Badge>
							</Link>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
