import { docList } from '@/constants/constant';
import Link from 'next/link';

export default function DocumentListPage() {
	return (
		<div className="min-h-screen px-6 py-12">
			<div className="mx-auto max-w-4xl">
				{/* Header */}
				<div className="mb-8">
					<h1 className="text-3xl font-bold text-foreground tracking-tight">Documentation</h1>
					<p className="text-muted-foreground text-sm mt-2">
						Explore our documentation to learn more about DepShield's features and architecture.
					</p>
				</div>

				{/* Doc cards */}
				<div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
					{docList.map((doc) => (
						<Link
							href={`/docs/${doc.slug}`}
							key={doc.id}
							className="group bg-card border border-border hover:border-primary/50 rounded-xl px-5 py-4 transition-all hover:bg-card/80"
						>
							<p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">{doc.name}</p>
							<p className="text-xs text-muted-foreground mt-1">View document →</p>
						</Link>
					))}
				</div>
			</div>
		</div>
	);
}
