import { MarkdownContent } from '@/components/docs/MarkdownContent';
import { docList } from '@/constants/constant';

export default async function DocumentContentDetail({ params }: { params: { slug: string } }) {
	const { slug } = await params;
	if (!docList.map((doc) => doc.slug).includes(slug)) return <div className="text-foreground/80 text-sm">Document not found.</div>;
	const contentModule = await import(`@/content/${slug}`);
	return <MarkdownContent content={contentModule.default} />;
}
