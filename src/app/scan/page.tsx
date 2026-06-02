'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { GithubIcon, GitlabIcon } from '@/components/icons';
import type { ApiResponse, StatusResponse } from '@/types';

const POLL_INTERVAL = 2000;

function ScanPageComponent() {
	const searchParams = useSearchParams();
	const router = useRouter();
	const jobId = searchParams.get('jobId');

	const [job, setJob] = useState<StatusResponse | null>(null);
	const [error, setError] = useState('');

	const poll = useCallback(async () => {
		if (!jobId) return;

		try {
			const res = await fetch(`/api/status/${jobId}`);
			const data: ApiResponse<StatusResponse> = await res.json();

			if (!res.ok || !data.success) {
				setError(data.message ?? 'Failed to fetch status');
				return;
			}

			setJob(data.data ?? null);
		} catch {
			setError('Failed to connect to server');
		}
	}, [jobId]);

	useEffect(() => {
		if (!jobId) {
			router.replace('/');
			return;
		}

		poll();

		const interval = setInterval(() => {
			setJob((prev) => {
				if (prev?.status === 'complete' || prev?.status === 'error') {
					clearInterval(interval);
					return prev;
				}
				return prev;
			});
			poll();
		}, POLL_INTERVAL);

		return () => clearInterval(interval);
	}, [jobId, poll, router]);

	// Redirect to dashboard when complete
	useEffect(() => {
		if (job?.status === 'complete') {
			setTimeout(() => {
				router.push(`/dashboard?jobId=${jobId}`);
			}, 1000);
		}
	}, [job?.status, jobId, router]);

	if (!jobId) return null;

	const progressPercent = job?.total ? Math.round((job.progress / job.total) * 100) : 0;

	const statusLabel =
		{
			pending: 'Initializing...',
			scanning: 'Scanning dependencies...',
			complete: 'Scan complete!',
			error: 'Scan failed',
		}[job?.status ?? 'pending'] ?? 'Loading...';

	return (
		<div className="min-h-screen flex flex-col items-center justify-center px-4 py-16">
			<div className="w-full max-w-lg">
				{/* Header */}
				<div className="mb-8 text-center">
					<h1 className="text-2xl font-bold text-foreground mb-2">
						{job?.status === 'complete' ? 'Scan Complete' : 'Scanning Repository'}
					</h1>
					<p className="text-muted-foreground text-sm">{job?.repoUrl ?? 'Loading...'}</p>
				</div>

				{/* Status Card */}
				<div className="bg-card border border-border rounded-xl p-6 mb-4">
					{/* Platform + Ecosystem badges */}
					<div className="flex items-center gap-2 mb-5">
						{job?.platform === 'github' ? (
							<div className="flex items-center gap-1.5 text-muted-foreground text-xs">
								<GithubIcon size={14} />
								<span>GitHub</span>
							</div>
						) : job?.platform === 'gitlab' ? (
							<div className="flex items-center gap-1.5 text-orange-400 text-xs">
								<GitlabIcon size={14} />
								<span>GitLab</span>
							</div>
						) : null}

						{job?.ecosystem && (
							<Badge variant="outline" className="text-xs border-border text-muted-foreground">
								{job.ecosystem}
							</Badge>
						)}

						{job?.packageManager && (
							<Badge variant="outline" className="text-xs border-border text-muted-foreground">
								{job.packageManager}
							</Badge>
						)}
					</div>

					{/* Progress */}
					<div className="mb-4">
						<div className="flex justify-between text-xs text-muted-foreground mb-2">
							<span>{statusLabel}</span>
							<span>{job?.total ? `${job.progress}/${job.total} packages` : ''}</span>
						</div>

						{/* Progress bar */}
						<div className="h-1.5 bg-muted rounded-full overflow-hidden">
							<div
								className="h-full bg-primary rounded-full transition-all duration-500"
								style={{
									width: job?.status === 'pending' ? '5%' : job?.status === 'complete' ? '100%' : `${Math.max(progressPercent, 8)}%`,
								}}
							/>
						</div>
					</div>

					{/* Status indicator */}
					<div className="flex items-center gap-2">
						{job?.status === 'complete' ? (
							<div className="w-2 h-2 rounded-full bg-risk-safe" />
						) : job?.status === 'error' ? (
							<div className="w-2 h-2 rounded-full bg-destructive" />
						) : (
							<div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
						)}
						<span className="text-xs text-muted-foreground">
							{job?.status === 'complete'
								? `${job.total} packages scanned`
								: job?.status === 'error'
									? (job.error ?? 'An error occurred')
									: 'Please wait...'}
						</span>
					</div>
				</div>

				{/* All detected ecosystems */}
				{job?.allDetected && job.allDetected.length > 1 && (
					<div className="bg-card border border-border rounded-xl p-4 mb-4">
						<p className="text-xs text-muted-foreground mb-3">Detected ecosystems</p>
						<div className="flex flex-wrap gap-2">
							{job.allDetected.map((d) => (
								<div key={d.basePath} className="flex items-center gap-1.5 text-xs">
									<Badge
										variant="outline"
										className={`text-xs ${d.supported ? 'border-primary/40 text-primary' : 'border-border text-muted-foreground'}`}
									>
										{d.ecosystem}
									</Badge>
									<span className="text-muted-foreground">{d.basePath}/</span>
									{!d.supported && <span className="text-muted-foreground/60 text-[10px]">detection only</span>}
								</div>
							))}
						</div>
					</div>
				)}

				{/* Error state */}
				{(error || job?.status === 'error') && (
					<div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4 mb-4">
						<p className="text-destructive text-sm">{error || job?.error}</p>
					</div>
				)}

				{/* Actions */}
				<div className="flex gap-3">
					<Button variant="outline" onClick={() => router.push('/')} className="flex-1">
						New Scan
					</Button>

					{job?.status === 'complete' && (
						<Button onClick={() => router.push(`/dashboard?jobId=${jobId}`)} className="flex-1">
							View Results
						</Button>
					)}
				</div>
			</div>
		</div>
	);
}

export default function ScanPage() {
	return (
		<Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading...</div>}>
			<ScanPageComponent />
		</Suspense>
	);
}
