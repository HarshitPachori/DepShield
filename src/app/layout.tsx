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
				<Navbar />
				<main className="mt-14">{children}</main>
			</body>
		</html>
	);
}
