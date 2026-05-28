import { docList } from '@/constants/constant';
import Link from 'next/link';

export default function DocumentListPage() {
	return (
		<div className="flex items-center justify-center gap-4 p-4">
			<div className="w-full max-w-sm sm:max-w-xl md:max-w-3xl lg:max-w-4xl">
				<div className="">
					<h1 className="text-2xl font-bold">Documentation</h1>
					<p className="text-slate-400 text-sm mt-1">Explore our documentation to learn more about our features and how to use them.</p>
				</div>
				<div className="flex flex-wrap gap-4 mt-5">
					{docList.map((doc) => (
						<Link
							href={`/docs/${doc.slug}`}
							key={doc.id}
							className="bg-slate-300 text-slate-700 rounded-lg px-4 py-2 hover:bg-slate-400 hover:text-slate-900 transition-colors font-semibold cursor-pointer"
						>
							{doc.name}
						</Link>
					))}
				</div>
			</div>
		</div>
	);
}
