import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import { CodeBlock } from '@/components/docs/CodeBlock';
import React from 'react';

function parseHeadingId(children: React.ReactNode): { id?: string; rendered: React.ReactNode } {
	const tryParse = (s: string) => {
		const match = s.match(/^(.*?)\s*\{#([^}]+)\}$/s);
		return match ? { id: match[2], text: match[1] } : null;
	};

	if (typeof children === 'string') {
		const parsed = tryParse(children);
		if (parsed) return { id: parsed.id, rendered: parsed.text };
	}

	if (Array.isArray(children)) {
		const last = children[children.length - 1];
		if (typeof last === 'string') {
			const parsed = tryParse(last);
			if (parsed) {
				const rest = children.slice(0, -1);
				return { id: parsed.id, rendered: [...rest, parsed.text] };
			}
		}
	}

	return { rendered: children };
}

const components: Components = {
	h1: ({ children }) => {
		const { id, rendered } = parseHeadingId(children);
		return (
			<h1 id={id} className="font-display text-slate-300 mb-2 text-3xl font-bold">
				{rendered}
			</h1>
		);
	},
	h2: ({ children }) => {
		const { id, rendered } = parseHeadingId(children);
		return (
			<h2 id={id} className="text-slate-300 mt-8 mb-3 text-lg font-semibold">
				{rendered}
			</h2>
		);
	},
	h3: ({ children }) => {
		const { id, rendered } = parseHeadingId(children);
		return (
			<h3 id={id} className="text-slate-300 mt-6 mb-2 text-base font-semibold">
				{rendered}
			</h3>
		);
	},
	p: ({ children }) => <p className="text-slate-300/80 mb-4 text-sm leading-relaxed">{children}</p>,
	ul: ({ children }) => <ul className="text-slate-300/80 marker:text-primary/80 mb-4 list-disc space-y-1.5 pl-5 text-sm">{children}</ul>,
	ol: ({ children }) => <ol className="text-slate-300/80 marker:text-primary/80 mb-4 list-decimal space-y-1.5 pl-5 text-sm">{children}</ol>,
	li: ({ children }) => <li className="leading-relaxed">{children}</li>,
	strong: ({ children }) => <strong className="text-slate-300 font-semibold">{children}</strong>,
	a: ({ href, children }) => (
		<a
			href={href}
			className="text-primary hover:text-primary/80 underline underline-offset-2 transition-colors"
			target={href?.startsWith('http') ? '_blank' : undefined}
			rel={href?.startsWith('http') ? 'noopener noreferrer' : undefined}
		>
			{children}
		</a>
	),
	hr: () => <hr className="border border-slate-700 my-6" />,
	blockquote: ({ children }) => (
		<blockquote className="border-primary/60 bg-primary/5 mb-4 rounded-r-lg border-l-4 px-4 py-3 text-sm">{children}</blockquote>
	),
	// code: ({ children, className }) => {
	// 	const isBlock = className?.startsWith('language-');
	// 	if (isBlock) return null;
	// 	return <code className="text-foreground rounded px-1.5 py-0.5 font-mono text-[0.8em]">{children}</code>;
	// },
	// pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
	// 1. Leave the code component ONLY for inline code formatting
	code: ({ children, className }) => {
		const isBlock = className?.includes('language-');
		if (isBlock) {
			// Do not render styling here; let the pre/CodeBlock components handle it
			return <>{children}</>;
		}
		return <code className="bg-muted text-slate-300 rounded px-1.5 py-0.5 font-mono text-[0.8em]">{children}</code>;
	},
	// 2. Safely extract language and code from pre's children
	pre: ({ children }) => {
		// react-markdown nests <code> inside <pre>
		const codeElement = React.Children.toArray(children)[0] as React.ReactElement<{ className?: string; children?: React.ReactNode }>;

		const language = codeElement?.props?.className?.replace('language-', '') || 'text';
		const rawCode = String(codeElement?.props?.children || '').replace(/\n$/, '');

		return <CodeBlock language={language}>{rawCode}</CodeBlock>;
	},
	table: ({ children }) => (
		<div className="border border-slate-700 mb-4 overflow-x-auto rounded-lg">
			<table className="w-full text-sm">{children}</table>
		</div>
	),
	thead: ({ children }) => <thead className="bg-gray-800">{children}</thead>,
	tbody: ({ children }) => <tbody className="divide-border divide-y divide-gray-700 border-gray-700">{children}</tbody>,
	tr: ({ children }) => <tr className="divide-border divide-x divide-gray-700 border-gray-700">{children}</tr>,
	th: ({ children }) => <th className="text-slate-300 px-4 py-2.5 text-left text-xs font-semibold">{children}</th>,
	td: ({ children }) => <td className="text-slate-300/80 px-4 py-2.5 text-xs">{children}</td>,
};

export function MarkdownContent({ content }: { content: string }) {
	return (
		<ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
			{content}
		</ReactMarkdown>
	);
}
