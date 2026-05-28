import Link from 'next/link';

export default function Navbar() {
	return (
		<div className="fixed top-0 left-0 right-0 w-full h-12 bg-slate-900/70 z-10 flex items-center py-2 px-5">
			<div className="w-full flex items-center justify-between">
				<Link href="/" className="m-8">
					<p className="font-bold tracking-wider">DepShield</p>
				</Link>
				<div className="">
					<Link href="/docs" className="text-sm text-slate-400 hover:text-muted-foreground/80">
						Docs
					</Link>
				</div>
			</div>
		</div>
	);
}
