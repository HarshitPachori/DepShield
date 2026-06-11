import logger from '@backend/util/logger';
import { getGoogleAccessToken } from '../helper';

const GEMINI_API_URL = (projectId: string) =>
	`https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent`;
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.1-8b-instant';

const formatNumberWithCommas = (num: number): string => {
	const str = Math.floor(num).toString();
	if (str.length <= 3) return str;

	let result = '';
	let count = 0;
	for (let i = str.length - 1; i >= 0; i--) {
		if (count === 3) {
			result = ',' + result;
			count = 0;
		}
		result = str[i] + result;
		count++;
	}
	return result;
};

const parseJson = (raw: string): any => {
	const trimmed = raw.trim();
	if (trimmed.startsWith('```')) {
		const clean = trimmed.replace(/```json|```/g, '').trim();
		return JSON.parse(clean);
	}
	return JSON.parse(trimmed);
};

const geminiGenerate = async (prompt: string, serviceAccountJson: string, projectId: string, forceJson = false): Promise<string> => {
	const body: Record<string, any> = {
		contents: [{ role: 'user', parts: [{ text: prompt }] }],
		generationConfig: {
			temperature: 0.3,
			...(forceJson ? { responseMimeType: 'application/json' } : {}),
		},
	};
	const accessToken = await getGoogleAccessToken(serviceAccountJson);
	const res = await fetch(`${GEMINI_API_URL(projectId)}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
		body: JSON.stringify(body),
	});

	if (!res.ok) {
		const errorBody = await res.text().catch(() => '');
		logger.warn('Gemini API failed', { status: res.status, error: errorBody });
		throw new Error(`Gemini API error: ${res.status}`);
	}

	const data = (await res.json()) as any;
	return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
};

const groqGenerate = async (prompt: string, apiKey: string, forceJson = false): Promise<string> => {
	const body: Record<string, any> = {
		model: GROQ_MODEL,
		messages: [{ role: 'user', content: prompt }],
		temperature: 0.3,
		max_tokens: 500,
		...(forceJson ? { response_format: { type: 'json_object' } } : {}),
	};

	const res = await fetch(GROQ_API_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify(body),
	});

	if (!res.ok) {
		const errorBody = await res.text().catch(() => '');
		logger.warn('Groq API failed', { status: res.status, error: errorBody });
		throw new Error(`Groq API error: ${res.status}`);
	}

	const data = (await res.json()) as any;
	return data.choices?.[0]?.message?.content ?? '';
};

const aiGenerate = async (
	prompt: string,
	geminiServiceAccount?: string,
	groqApiKey?: string,
	projectId?: string,
	forceJson = false,
): Promise<string> => {
	if (!geminiServiceAccount && !groqApiKey) {
		throw new Error('No AI provider available');
	}

	if (geminiServiceAccount && projectId) {
		try {
			const result = await geminiGenerate(prompt, geminiServiceAccount, projectId, forceJson);
			logger.info('AI generated via Gemini');
			return result;
		} catch (err) {
			logger.warn('Gemini failed, falling back to Groq', { error: err instanceof Error ? err.message : err });

			if (!groqApiKey) {
				throw new Error('Gemini failed and no Groq fallback configured');
			}
		}
	}

	try {
		const result = await groqGenerate(prompt, groqApiKey!, forceJson);
		logger.info('AI generated via Groq fallback');
		return result;
	} catch (err) {
		logger.error('Groq fallback also failed', err instanceof Error ? err : undefined);
		throw new Error('All AI providers failed');
	}
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
	serviceAccountJson?: string,
	groqApiKey?: string,
	projectId?: string,
): Promise<string> => {
	if (!serviceAccountJson && !groqApiKey) {
		logger.warn('No AI keys configured for risk explanation', { package: packageName });
		return '';
	}

	const prompt = `You are a dependency security expert. Analyze this npm package and provide a concise 2-3 sentence risk explanation.

Package: ${packageName} (${ecosystem})
Deprecated: ${signals.isDeprecated}
Last commit: ${signals.lastCommitDaysAgo} days ago
Download trend: ${signals.downloadTrendPercent}% over 3 months
Weekly downloads: ${formatNumberWithCommas(signals.weeklyDownloads)}
Maintainer active: ${signals.maintainerActive}
Known CVEs: ${signals.openCveCount}
${signals.communitySignal ? `Community note: ${signals.communitySignal}` : ''}
${cves.length > 0 ? `Top CVE: ${cves[0].id} - ${cves[0].description}` : ''}

Write exactly 2 sentences explaining why this package is risky. Be specific. Do not use markdown. Do not use em dashes. Do not exceed 2 sentences`;

	try {
		const result = await aiGenerate(prompt, serviceAccountJson, groqApiKey, projectId, false);
		logger.info('Risk explanation generated', { package: packageName });
		return result.trim();
	} catch (err) {
		logger.error('AI explanation failed', err instanceof Error ? err : undefined, { package: packageName });
		return '';
	}
};

export const suggestAlternative = async (
	packageName: string,
	ecosystem: string,
	isDeprecated: boolean,
	serviceAccountJson?: string,
	groqApiKey?: string,
	projectId?: string,
): Promise<{ name: string; reason: string } | null> => {
	if (!serviceAccountJson && !groqApiKey) {
		logger.warn('No AI keys configured for alternative suggestion', { package: packageName });
		return null;
	}

	const prompt = `You are a Node.js expert. Suggest the single best replacement package for "${packageName}" in ${ecosystem}.

${isDeprecated ? `${packageName} is officially deprecated.` : `${packageName} is abandoned/unmaintained.`}

Respond with ONLY a JSON object in this exact format, no other text. Do not use em dashes:
{"name": "package-name", "reason": "one sentence why it is the best replacement"}`;

	try {
		const response = await aiGenerate(prompt, serviceAccountJson, groqApiKey, projectId, true);
		const parsed = parseJson(response);
		logger.info('Alternative suggested', { package: packageName, alternative: parsed?.name });
		return parsed;
	} catch (err) {
		logger.error('AI alternative failed', err instanceof Error ? err : undefined, { package: packageName });
		return null;
	}
};

export const estimateMigrationComplexity = async (
	fromPackage: string,
	toPackage: string,
	serviceAccountJson?: string,
	groqApiKey?: string,
	projectId?: string,
): Promise<{ complexity: 'low' | 'medium' | 'high'; estimate: string }> => {
	const prompt = `Estimate the migration complexity from "${fromPackage}" to "${toPackage}" in a Node.js project.

Respond with ONLY a JSON object in this exact format, no other text. Do not use em dashes or dashes to connect clauses. Use simple sentences only:
{"complexity": "low|medium|high", "estimate": "time estimate like '1-2 hours' or '1 day'"}`;

	try {
		const response = await aiGenerate(prompt, serviceAccountJson, groqApiKey, projectId, true);
		const parsed = parseJson(response);
		logger.info('Migration complexity estimated', { fromPackage, toPackage, complexity: parsed?.complexity });
		return parsed;
	} catch (err) {
		logger.warn('Migration complexity estimation failed, using default', { fromPackage, toPackage });
		return { complexity: 'medium', estimate: 'a few hours' };
	}
};
