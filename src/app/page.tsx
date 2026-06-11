'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Shield, Zap, GitPullRequest, Clock, CheckCircle, AlertCircle, KeyRound, ChevronDown, ChevronUp } from 'lucide-react';
import { GithubIcon, GitlabIcon } from '@/components/icons';
import type { ApiResponse, ScanResponse } from '@/types';

const XOR_KEY = 'depshield-local-v1';
const xorObfuscate = (str: string): string => {
	try {
		return btoa(
			str
				.split('')
				.map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ XOR_KEY.charCodeAt(i % XOR_KEY.length)))
				.join(''),
		);
	} catch {
		return '';
	}
};
const xorDeobfuscate = (encoded: string): string => {
	try {
		const str = atob(encoded);
		return str
			.split('')
			.map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ XOR_KEY.charCodeAt(i % XOR_KEY.length)))
			.join('');
	} catch {
		return '';
	}
};

interface ScanHistory {
	jobId: string;
	repoUrl: string;
	platform: string;
	startedAt: number;
	status: string;
}

export default function Home() {
	const router = useRouter();
	const [repoUrl, setRepoUrl] = useState('');
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState('');
	const [recentScans, setRecentScans] = useState<ScanHistory[]>([]);
	const [showPat, setShowPat] = useState(false);
	const [githubPat, setGithubPat] = useState('');
	const [gitlabPat, setGitlabPat] = useState('');

	useEffect(() => {
		const history = JSON.parse(localStorage.getItem('depshield_scans') ?? '[]');
		setRecentScans(history);
		const gh = localStorage.getItem('depshield_gh_pat');
		const gl = localStorage.getItem('depshield_gl_pat');
		if (gh) setGithubPat(xorDeobfuscate(gh));
		if (gl) setGitlabPat(xorDeobfuscate(gl));
	}, []);

	const savePat = (platform: 'github' | 'gitlab', value: string) => {
		const key = platform === 'github' ? 'depshield_gh_pat' : 'depshield_gl_pat';
		if (value) localStorage.setItem(key, xorObfuscate(value));
		else localStorage.removeItem(key);
	};

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
			const token = platform === 'github' ? githubPat.trim() : gitlabPat.trim();
			const res = await fetch('/api/scan', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ repoUrl, ...(token ? { token } : {}) }),
			});
			const data: ApiResponse<ScanResponse> = await res.json();
			if (!res.ok || !data.success) {
				setError(data.message ?? 'Failed to start scan');
				return;
			}
			const history = JSON.parse(localStorage.getItem('depshield_scans') ?? '[]');
			const newScan: ScanHistory = {
				jobId: data.data?.jobId!,
				repoUrl,
				platform,
				startedAt: Date.now(),
				status: 'scanning',
			};
			history.unshift(newScan);
			localStorage.setItem('depshield_scans', JSON.stringify(history.slice(0, 10)));
			router.push(`/scan?jobId=${data.data?.jobId}`);
		} catch {
			setError('Something went wrong. Please try again.');
		} finally {
			setLoading(false);
		}
	};

	const platform = detectPlatform(repoUrl);

	const formatTime = (ts: number) => {
		const diff = Date.now() - ts;
		const mins = Math.floor(diff / 60000);
		const hours = Math.floor(diff / 3600000);
		const days = Math.floor(diff / 86400000);
		if (days > 0) return `${days}d ago`;
		if (hours > 0) return `${hours}h ago`;
		if (mins > 0) return `${mins}m ago`;
		return 'just now';
	};

	const getRepoName = (url: string) => {
		try {
			return new URL(url).pathname.slice(1);
		} catch {
			return url;
		}
	};

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
					Detect CVEs and silent abandonment risks across your dependencies. Get AI-powered migration PRs automatically.
				</p>

				{/* Scan Input */}
				<div className="w-full max-w-2xl">
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

					{/* Mobile */}
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

					{error && <p className="text-destructive text-xs mt-2 text-left pl-1">{error}</p>}
					{platform && !error && (
						<p className="text-muted-foreground text-xs mt-2 text-left pl-1">
							{platform === 'github' ? '🐙 GitHub' : '🦊 GitLab'} repository detected
						</p>
					)}

					{/* PAT Settings */}
					<div className="mt-3">
						<button
							onClick={() => setShowPat((v) => !v)}
							className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
						>
							<KeyRound size={12} />
							<span>Private repo or auto-PR? Add tokens</span>
							{showPat ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
						</button>

						{showPat && (
							<div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
								<div className="flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-2">
									<GithubIcon size={14} className="text-muted-foreground shrink-0" />
									<Input
										type="password"
										value={githubPat}
										onChange={(e) => {
											setGithubPat(e.target.value);
											savePat('github', e.target.value);
										}}
										placeholder="GitHub PAT (ghp_...)"
										className="flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0 text-xs placeholder:text-muted-foreground/40 p-0 h-auto"
									/>
								</div>
								<div className="flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-2">
									<GitlabIcon size={14} className="text-orange-400 shrink-0" />
									<Input
										type="password"
										value={gitlabPat}
										onChange={(e) => {
											setGitlabPat(e.target.value);
											savePat('gitlab', e.target.value);
										}}
										placeholder="GitLab PAT (glpat-...)"
										className="flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0 text-xs placeholder:text-muted-foreground/40 p-0 h-auto"
									/>
								</div>
								<p className="text-muted-foreground/60 text-[10px] sm:col-span-2 pl-1">
									Tokens stored locally (obfuscated). Used for private repos and auto-creating migration PRs/MRs.
								</p>
							</div>
						)}
					</div>
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

				{/* Recent Scans */}
				{recentScans.length > 0 && (
					<div className="w-full max-w-2xl mt-10">
						<div className="flex items-center gap-2 mb-3">
							<Clock size={14} className="text-muted-foreground" />
							<p className="text-xs text-muted-foreground font-medium">Recent scans</p>
						</div>
						<div className="space-y-2">
							{recentScans.slice(0, 5).map((scan) => (
								<button
									key={scan.jobId}
									onClick={() => router.push(`/dashboard?jobId=${scan.jobId}`)}
									className="w-full flex items-center justify-between bg-card border border-border hover:border-primary/30 rounded-xl px-4 py-3 transition-colors text-left group"
								>
									<div className="flex items-center gap-3 min-w-0">
										{scan.platform === 'github' ? (
											<GithubIcon size={14} className="text-muted-foreground shrink-0" />
										) : (
											<GitlabIcon size={14} className="text-orange-400 shrink-0" />
										)}
										<span className="text-sm text-foreground truncate group-hover:text-primary transition-colors">
											{getRepoName(scan.repoUrl)}
										</span>
									</div>
									<div className="flex items-center gap-2 shrink-0 ml-3">
										<span className="text-xs text-muted-foreground">{formatTime(scan.startedAt)}</span>
										{scan.status === 'complete' ? (
											<CheckCircle size={14} className="text-risk-safe" />
										) : scan.status === 'error' ? (
											<AlertCircle size={14} className="text-destructive" />
										) : (
											<Clock size={14} className="text-muted-foreground" />
										)}
									</div>
								</button>
							))}
						</div>
					</div>
				)}
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
							desc: 'AI-generated, tested migration pull requests ready to review and merge.',
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
