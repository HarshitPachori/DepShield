import Link from 'next/link';

export default function Navbar() {
	return (
		// <nav className="fixed top-0 left-0 right-0 w-full h-14 z-50 border-b border-border/50 bg-background/80 backdrop-blur-md">
		<nav className="fixed top-15 sm:top-12 md:top-10  lg:top-8 xl:top-7 left-0 right-0 w-full h-14 z-50 border-b border-border/50 bg-background/80 backdrop-blur-md">
			<div className="w-full h-full flex items-center justify-between px-6">
				<Link href="/" className="flex items-center gap-2">
					<span className="font-bold text-base tracking-tight text-foreground">
						Dep<span className="text-primary">Shield</span>
					</span>
				</Link>
				<div className="flex items-center gap-6">
					<Link href="/docs" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
						Docs
					</Link>
					<Link
						href="/scan"
						className="text-sm bg-primary text-primary-foreground px-4 py-1.5 rounded-md hover:bg-primary/90 transition-colors font-medium"
					>
						Scan Repo
					</Link>
				</div>
			</div>
		</nav>
	);
}
