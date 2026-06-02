export default function Home() {
	return (
		<div className="min-h-screen flex flex-col items-center justify-center px-6">
			{/* Hero section placeholder */}
			<div className="text-center max-w-2xl">
				<h1 className="text-5xl font-bold tracking-tight text-foreground mb-4">
					Your codebase's
					<br />
					<span className="text-primary">last line of defense</span>
				</h1>
				<p className="text-muted-foreground text-lg mb-8">
					Detect vulnerabilities and silent abandonment risks. Auto-migrate with tested PRs.
				</p>
				{/* Scan input — next step */}
			</div>
		</div>
	);
}
