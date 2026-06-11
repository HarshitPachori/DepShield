import Navbar from '@/components/Navbar';
import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const inter = Inter({
	variable: '--font-inter',
	subsets: ['latin'],
	weight: ['400', '500', '600', '700'],
});

const jetbrainsMono = JetBrains_Mono({
	variable: '--font-jetbrains-mono',
	subsets: ['latin'],
	weight: ['400', '500'],
});

export const metadata: Metadata = {
	title: 'DepShield : AI-Powered Dependency Intelligence',
	description: 'Detect vulnerabilities and silent abandonment risks in your dependencies. Auto-migrate with tested PRs.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" className={`dark ${inter.variable} ${jetbrainsMono.variable}`}>
			<head>
				<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
			</head>
			<body className={`${inter.variable} ${jetbrainsMono.variable} antialiased min-h-screen bg-background text-foreground`}>
				<div className="fixed top-0 left-0 right-0 w-full bg-primary/90 text-shadow-accent-foreground text-xs py-2 px-4 text-center z-60">
					⚡ DepShield is running on a free Cloudflare Workers account for demo purposes, not production-grade infrastructure. Built for the
					Google Cloud Rapid Agent Hackathon.
				</div>
				<Navbar />
				<main className="mt-20">{children}</main>
			</body>
		</html>
	);
}
