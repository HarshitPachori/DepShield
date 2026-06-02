'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Shield, Zap, GitPullRequest } from 'lucide-react';
import { GithubIcon, GitlabIcon } from '@/components/icons';
import { ApiResponse, ScanResponse } from '@/types';

export default function Home() {
	const router = useRouter();
	const [repoUrl, setRepoUrl] = useState('');
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState('');

	const detectPlatform = (url: string) => {
		if (url.includes('github.com')) return 'github';
		if (url.includes('gitlab.com')) return 'gitlab';
		return null;
	};

	const handleScan = async () => {
		if (!repoUrl.trim()) {
			setError('Please enter a repository URL');
			return;
		}
		const platform = detectPlatform(repoUrl);
		if (!platform) {
			setError('Only GitHub and GitLab repositories are supported');
			return;
		}
		setError('');
		setLoading(true);
		try {
			const res = await fetch('/api/scan', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ repoUrl }),
			});
			const data: ApiResponse<ScanResponse> = await res.json();
			if (!res.ok || !data.success) {
				setError(data.message ?? 'Failed to start scan');
				return;
			}
			const history = JSON.parse(localStorage.getItem('depshield_scans') ?? '[]');
			history.unshift({
				jobId: data.data?.jobId,
				repoUrl,
				platform,
				startedAt: Date.now(),
				status: 'scanning',
			});
			localStorage.setItem('depshield_scans', JSON.stringify(history.slice(0, 10)));
			router.push(`/scan?jobId=${data.data?.jobId}`);
		} catch {
			setError('Something went wrong. Please try again.');
		} finally {
			setLoading(false);
		}
	};

	const platform = detectPlatform(repoUrl);

	return (
		<div className="min-h-screen flex flex-col">
			{/* Hero */}
			<section className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 py-16 sm:py-24 text-center">
				<Badge variant="outline" className="mb-5 border-primary/30 text-primary bg-primary/5 px-3 py-1 text-xs">
					AI-Powered Dependency Intelligence
				</Badge>
				<h1 className="text-3xl sm:text-5xl md:text-6xl font-bold tracking-tight text-foreground max-w-2xl leading-tight mb-4 sm:mb-6">
					Your codebase's <span className="text-primary">last line of defense</span>
				</h1>
				<p className="text-muted-foreground text-sm sm:text-lg max-w-xl mb-8 sm:mb-12 leading-relaxed px-2">
					Detect CVEs and silent abandonment risks across your dependencies. Get AI-powered migration PRs - automatically.
				</p>

				{/* Scan Input */}
				<div className="w-full max-w-2xl px-0 sm:px-0">
					{/* Desktop - single row */}
					<div className="hidden sm:flex gap-2 p-1.5 bg-card border border-border hover:border-primary/40 rounded-xl transition-colors">
						<div className="flex items-center pl-3 text-muted-foreground">
							{platform === 'github' ? (
								<GithubIcon size={18} />
							) : platform === 'gitlab' ? (
								<GitlabIcon size={18} className="text-orange-400" />
							) : (
								<Shield size={16} />
							)}
						</div>
						<Input
							value={repoUrl}
							onChange={(e) => {
								setRepoUrl(e.target.value);
								setError('');
							}}
							onKeyDown={(e) => e.key === 'Enter' && handleScan()}
							placeholder="github.com/owner/repo or gitlab.com/owner/repo"
							className="flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0 text-sm placeholder:text-muted-foreground/50"
						/>
						<Button onClick={handleScan} disabled={loading} className="px-6 rounded-lg shrink-0">
							{loading ? 'Starting...' : 'Scan Now'}
						</Button>
					</div>

					{/* Mobile - stacked */}
					<div className="flex sm:hidden flex-col gap-2">
						<div className="flex items-center gap-2 bg-card border border-border rounded-xl px-3 py-2.5">
							<div className="text-muted-foreground">
								{platform === 'github' ? (
									<GithubIcon size={16} />
								) : platform === 'gitlab' ? (
									<GitlabIcon size={16} className="text-orange-400" />
								) : (
									<Shield size={16} />
								)}
							</div>
							<Input
								value={repoUrl}
								onChange={(e) => {
									setRepoUrl(e.target.value);
									setError('');
								}}
								onKeyDown={(e) => e.key === 'Enter' && handleScan()}
								placeholder="github.com/owner/repo"
								className="flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0 text-sm placeholder:text-muted-foreground/50 p-0 h-auto"
							/>
						</div>
						<Button onClick={handleScan} disabled={loading} className="w-full">
							{loading ? 'Starting...' : 'Scan Now'}
						</Button>
					</div>

					{/* Error */}
					{error && <p className="text-destructive text-xs mt-2 text-left pl-1">{error}</p>}

					{/* Platform detected */}
					{platform && !error && (
						<p className="text-muted-foreground text-xs mt-2 text-left pl-1">
							{platform === 'github' ? '🐙 GitHub' : '🦊 GitLab'} repository detected
						</p>
					)}
				</div>

				{/* Example repos */}
				<div className="flex flex-wrap gap-x-3 gap-y-1 mt-5 justify-center items-center">
					<span className="text-muted-foreground text-xs">Try:</span>
					{['github.com/expressjs/express', 'github.com/axios/axios'].map((example) => (
						<button
							key={example}
							onClick={() => setRepoUrl(`https://${example}`)}
							className="text-xs text-primary/70 hover:text-primary transition-colors underline underline-offset-2"
						>
							{example}
						</button>
					))}
				</div>
			</section>

			{/* Features */}
			<section className="border-t border-border px-4 sm:px-6 py-12 sm:py-16">
				<div className="max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-4">
					{[
						{
							icon: <Shield size={20} className="text-primary" />,
							title: 'CVE Detection',
							desc: 'Real-time vulnerability scanning via OSV.dev across npm, PyPI, Maven, Go, and more.',
						},
						{
							icon: <Zap size={20} className="text-risk-medium" />,
							title: 'Abandonment Detection',
							desc: 'Catch silently dying packages before they become production emergencies.',
						},
						{
							icon: <GitPullRequest size={20} className="text-risk-safe" />,
							title: 'Auto Migration PRs',
							desc: 'AI-generated, tested migration pull requests - ready to review and merge.',
						},
					].map((f) => (
						<div key={f.title} className="bg-card border border-border/60 hover:border-primary/30 rounded-xl p-5 sm:p-6 transition-colors">
							<div className="mb-3">{f.icon}</div>
							<h3 className="text-foreground font-semibold text-sm mb-2">{f.title}</h3>
							<p className="text-muted-foreground text-xs leading-relaxed">{f.desc}</p>
						</div>
					))}
				</div>
			</section>
		</div>
	);
}
