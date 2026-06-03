import logger from '@backend/util/logger';

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.1-8b-instant';

const groqGenerate = async (prompt: string, apiKey: string): Promise<string> => {
	const res = await fetch(GROQ_API_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify({
			model: GROQ_MODEL,
			messages: [{ role: 'user', content: prompt }],
			temperature: 0.3,
			max_tokens: 500,
		}),
	});

	if (!res.ok) throw new Error(`Groq API error: ${res.status}`);

	const data = (await res.json()) as any;
	return data.choices?.[0]?.message?.content ?? '';
};

const geminiGenerate = async (prompt: string, apiKey: string): Promise<string> => {
	const res = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			contents: [{ parts: [{ text: prompt }] }],
			generationConfig: { temperature: 0.3, maxOutputTokens: 500 },
		}),
	});

	if (!res.ok) throw new Error(`Gemini API error: ${res.status}`);

	const data = (await res.json()) as any;
	return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
};

const aiGenerate = async (prompt: string, geminiApiKey?: string, groqApiKey?: string): Promise<string> => {
	if (geminiApiKey) {
		try {
			return await geminiGenerate(prompt, geminiApiKey);
		} catch (err) {
			logger.info('Gemini failed, falling back to Groq', { err });
		}
	}

	if (groqApiKey) {
		return await groqGenerate(prompt, groqApiKey);
	}

	throw new Error('No AI provider available');
};

export const generateRiskExplanation = async (
	packageName: string,
	ecosystem: string,
	signals: {
		isDeprecated: boolean;
		lastCommitDaysAgo: number;
		downloadTrendPercent: number;
		openCveCount: number;
		maintainerActive: boolean;
		weeklyDownloads: number;
		communitySignal?: string;
	},
	cves: Array<{ id: string; severity: string; description: string }>,
	geminiApiKey?: string,
	groqApiKey?: string,
): Promise<string> => {
	const prompt = `You are a dependency security expert. Analyze this npm package and provide a concise 2-3 sentence risk explanation.

Package: ${packageName} (${ecosystem})
Deprecated: ${signals.isDeprecated}
Last commit: ${signals.lastCommitDaysAgo} days ago
Download trend: ${signals.downloadTrendPercent}% over 3 months
Weekly downloads: ${signals.weeklyDownloads.toLocaleString()}
Maintainer active: ${signals.maintainerActive}
Known CVEs: ${signals.openCveCount}
${signals.communitySignal ? `Community note: ${signals.communitySignal}` : ''}
${cves.length > 0 ? `Top CVE: ${cves[0].id} - ${cves[0].description}` : ''}

Write a clear, factual 2-3 sentence explanation of why this package is risky. Be specific about the risks. Do not use markdown. Do not use em dashes or dashes to connect clauses. Use simple sentences only.`;

	try {
		const explanation = await aiGenerate(prompt, geminiApiKey, groqApiKey);
		return explanation.trim();
	} catch (err) {
		logger.error('AI explanation failed', err, { packageName });
		return '';
	}
};

export const suggestAlternative = async (
	packageName: string,
	ecosystem: string,
	isDeprecated: boolean,
	geminiApiKey?: string,
	groqApiKey?: string,
): Promise<{ name: string; reason: string } | null> => {
	const prompt = `You are a Node.js expert. Suggest the single best replacement package for "${packageName}" in ${ecosystem}.

${isDeprecated ? `${packageName} is officially deprecated.` : `${packageName} is abandoned/unmaintained.`}

Respond with ONLY a JSON object in this exact format, no other text. Do not use em dashes:
{"name": "package-name", "reason": "one sentence why it is the best replacement"}`;

	try {
		const response = await aiGenerate(prompt, geminiApiKey, groqApiKey);
		const cleaned = response
			.trim()
			.replace(/```json|```/g, '')
			.trim();
		const parsed = JSON.parse(cleaned);
		return parsed;
	} catch (err) {
		logger.error('AI alternative failed', err, { packageName });
		return null;
	}
};

export const estimateMigrationComplexity = async (
	fromPackage: string,
	toPackage: string,
	geminiApiKey?: string,
	groqApiKey?: string,
): Promise<{ complexity: 'low' | 'medium' | 'high'; estimate: string }> => {
	const prompt = `Estimate the migration complexity from "${fromPackage}" to "${toPackage}" in a Node.js project.

Respond with ONLY a JSON object in this exact format, no other text. Do not use em dashes or dashes to connect clauses. Use simple sentences only:
{"complexity": "low|medium|high", "estimate": "time estimate like '1-2 hours' or '1 day'"}`;

	try {
		const response = await aiGenerate(prompt, geminiApiKey, groqApiKey);
		const cleaned = response
			.trim()
			.replace(/```json|```/g, '')
			.trim();
		return JSON.parse(cleaned);
	} catch {
		return { complexity: 'medium', estimate: 'a few hours' };
	}
};
