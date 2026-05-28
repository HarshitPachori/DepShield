'use client';

import React, { useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';

// Official GitHub Dark theme tokens mapped into Prism JSON format
const githubDarkTheme: { [key: string]: React.CSSProperties } = {
	'code[class*="language-"]': {
		color: '#c9d1d9',
		background: 'none',
		fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
	},
	'pre[class*="language-"]': {
		color: '#c9d1d9',
		background: 'none',
		fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
	},
	comment: { color: '#8b949e', fontStyle: 'italic' },
	prolog: { color: '#8b949e' },
	doctype: { color: '#8b949e' },
	cdata: { color: '#8b949e' },
	punctuation: { color: '#c9d1d9' },
	property: { color: '#79c0ff' },
	tag: { color: '#7ee787' },
	boolean: { color: '#ff7b72' },
	number: { color: '#79c0ff' },
	constant: { color: '#79c0ff' },
	symbol: { color: '#79c0ff' },
	deleted: { color: '#ffa198', backgroundColor: '#490202' },
	selector: { color: '#7ee787' },
	'attr-name': { color: '#ff7b72' },
	string: { color: '#a5d6ff' },
	char: { color: '#a5d6ff' },
	builtin: { color: '#79c0ff' },
	inserted: { color: '#56d364', backgroundColor: '#033a16' },
	operator: { color: '#ff7b72' },
	entity: { color: '#79c0ff', cursor: 'help' },
	url: { color: '#79c0ff' },
	variable: { color: '#ffa657' },
	atrule: { color: '#ff7b72' },
	'attr-value': { color: '#a5d6ff' },
	function: { color: '#d2a8ff' },
	class_name: { color: '#ffa657' },
	keyword: { color: '#ff7b72' },
	regex: { color: '#a5d6ff' },
	important: { color: '#ff7b72', fontWeight: 'bold' },
	bold: { fontWeight: 'bold' },
	italic: { fontStyle: 'italic' },
};

interface CodeBlockProps {
	children: string;
	language?: string;
}

export function CodeBlock({ children, language = 'text' }: CodeBlockProps) {
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		await navigator.clipboard.writeText(children);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	const isPlaintext = language === 'text' || language === 'plaintext';

	return (
		<div className="border border-slate-700 bg-[#0d1117] relative my-4 overflow-hidden rounded-lg">
			{/* GitHub Header Styling */}
			<div className="border border-slate-700/80 bg-[#161b22] flex items-center justify-between border-b px-4 py-2 text-xs text-[#8b949e] font-mono">
				<span className="font-medium">{language}</span>
				<button onClick={handleCopy} className="hover:text-[#c9d1d9] rounded px-2 py-0.5 transition-colors focus:outline-none">
					{copied ? 'Copied!' : 'Copy'}
				</button>
			</div>

			{/* Code Area */}
			<div className="p-4 overflow-x-auto text-xs font-mono leading-relaxed">
				{isPlaintext ? (
					// Exact text formatting matches GitHub's custom layout font colors
					<pre className="text-slate-300 whitespace-pre font-mono selection:bg-[#264f78]">{children}</pre>
				) : (
					<SyntaxHighlighter language={language} style={githubDarkTheme} customStyle={{ margin: 0, padding: 0, background: 'transparent' }}>
						{children}
					</SyntaxHighlighter>
				)}
			</div>
		</div>
	);
}
