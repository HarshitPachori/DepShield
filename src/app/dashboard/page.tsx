'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { ApiResponse, StatusResponse, PackageRisk } from '@/types';

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

function DashboardPageComponent() {
	const searchParams = useSearchParams();
	const router = useRouter();
	const jobId = searchParams.get('jobId');

	const [job, setJob] = useState<StatusResponse | null>(null);
	const [filter, setFilter] = useState<string>('ALL');
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		if (!jobId) {
			router.replace('/');
			return;
		}

		const fetch_ = async () => {
			try {
				const res = await fetch(`/api/status/${jobId}`);
				const data: ApiResponse<StatusResponse> = await res.json();
				if (data.success && data.data) setJob(data.data);
			} finally {
				setLoading(false);
			}
		};
		fetch_();
	}, [jobId, router]);

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
					<Button variant="outline" onClick={() => router.push('/')}>
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
				<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
					<div>
						<h1 className="text-2xl font-bold text-foreground">Scan Results</h1>
						<p className="text-muted-foreground text-sm mt-1 truncate max-w-md">{job.repoUrl}</p>
					</div>
					<div className="flex items-center gap-2">
						<Badge variant="outline" className="text-xs border-border text-muted-foreground">
							{job.ecosystem}
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
							className={`bg-card border rounded-xl p-4 text-left transition-colors ${
								filter === s.level ? RISK_BG[s.level] : 'border-border hover:border-border/80'
							}`}
						>
							<p className={`text-2xl font-bold ${RISK_COLORS[s.level]}`}>{s.count}</p>
							<p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
						</button>
					))}
				</div>

				{/* Filter tabs */}
				<div className="flex items-center gap-1 mb-4 flex-wrap">
					{filterOptions.map((f) => (
						<button
							key={f.value}
							onClick={() => setFilter(f.value)}
							className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
								filter === f.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
							}`}
						>
							{f.label}
							{f.count > 0 && <span className="ml-1.5 opacity-70">{f.count}</span>}
						</button>
					))}
				</div>

				{/* Package list */}
				<div className="space-y-2">
					{filtered.length === 0 ? (
						<div className="bg-card border border-border rounded-xl p-8 text-center">
							<p className="text-muted-foreground text-sm">No packages in this category.</p>
						</div>
					) : (
						filtered.map((pkg) => <PackageRow key={pkg.name} pkg={pkg} />)
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

function PackageRow({ pkg }: { pkg: PackageRisk }) {
	const [expanded, setExpanded] = useState(false);
	const [showAllCves, setShowAllCves] = useState(false);

	return (
		<div className="bg-card border border-border rounded-xl overflow-hidden">
			{/* Row */}
			<button
				onClick={() => setExpanded(!expanded)}
				className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
			>
				{/* Risk dot */}
				<div className={`w-2 h-2 rounded-full shrink-0 ${RISK_DOT[pkg.riskLevel]}`} />

				{/* Name + version */}
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2 flex-wrap">
						<span className="text-foreground text-sm font-medium truncate">{pkg.name}</span>
						<span className="text-muted-foreground text-xs shrink-0">{pkg.declaredVersion}</span>
					</div>
					<p className="text-muted-foreground text-xs mt-0.5 truncate">{pkg.explanation}</p>
				</div>

				{/* Right side */}
				<div className="flex items-center gap-3 shrink-0">
					{pkg.cves.length > 0 && (
						<span className="text-xs text-muted-foreground">
							{pkg.cves.length} CVE{pkg.cves.length > 1 ? 's' : ''}
						</span>
					)}
					<Badge variant="outline" className={`text-xs ${RISK_BG[pkg.riskLevel]} ${RISK_COLORS[pkg.riskLevel]}`}>
						{pkg.riskLevel}
					</Badge>
					<span className={`text-sm font-bold ${RISK_COLORS[pkg.riskLevel]}`}>{pkg.riskScore}</span>
				</div>
			</button>

			{/* Expanded detail */}
			{expanded && (
				<div className="border-t border-border px-4 py-4 bg-muted/10">
					{/* Signals */}
					<div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
						{[
							{ label: 'Deprecated', value: pkg.signals.isDeprecated ? 'Yes' : 'No', danger: pkg.signals.isDeprecated },
							{ label: 'Last commit', value: `${pkg.signals.lastCommitDaysAgo}d ago`, danger: pkg.signals.lastCommitDaysAgo > 180 },
							{
								label: 'Download trend',
								value: `${pkg.signals.downloadTrendPercent > 0 ? '+' : ''}${pkg.signals.downloadTrendPercent}%`,
								danger: pkg.signals.downloadTrendPercent < -25,
							},
							{ label: 'CVEs', value: String(pkg.signals.openCveCount), danger: pkg.signals.openCveCount > 0 },
						].map((s) => (
							<div key={s.label} className="bg-card border border-border rounded-lg p-3">
								<p className="text-muted-foreground text-xs mb-1">{s.label}</p>
								<p className={`text-sm font-medium ${s.danger ? 'text-destructive' : 'text-foreground'}`}>{s.value}</p>
							</div>
						))}
					</div>
					{/* Strategy */}
					<div className="flex items-center gap-3 flex-wrap">
						<Badge variant="outline" className="text-xs border-border text-muted-foreground">
							Strategy: {pkg.fixStrategy}
						</Badge>
						{pkg.alternative && (
							<Badge variant="outline" className="text-xs border-primary/40 text-primary">
								Alternative: {pkg.alternative}
							</Badge>
						)}
					</div>
					{/* CVE list */}
					{pkg.cves.length > 0 && (
						<div className="mt-4">
							<p className="text-xs text-muted-foreground mb-2">Vulnerabilities</p>
							<div className="space-y-1.5">
								{(showAllCves ? pkg.cves : pkg.cves.slice(0, 3)).map((cve) => (
									<div key={cve.id} className="flex items-start gap-2 text-xs">
										<span className={`shrink-0 font-mono ${RISK_COLORS[cve.severity]}`}>{cve.id}</span>
										<span className="text-muted-foreground">{cve.description}</span>
									</div>
								))}
								{pkg.cves.length > 3 && (
									<button onClick={() => setShowAllCves(!showAllCves)} className="text-primary text-xs hover:underline mt-1">
										{showAllCves ? 'Show less' : `+${pkg.cves.length - 3} more`}
									</button>
								)}
							</div>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
