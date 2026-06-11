import { Hono } from 'hono';
import {
	queryElastic,
	createGitLabMR,
	createGitHubPR,
	checkGitLabCI,
	checkGitHubCI,
	indexAlternative,
	transformFileWithAI,
} from '@/backend/service/mcp.service';
import logger from '@backend/util/logger';
import { getGlobalRiskLeaderboard, searchScans } from '../service/elastic.service';

export const mcpRouter = new Hono<{ Bindings: CloudflareEnv }>();

const TOOLS = [
	{
		name: 'query_elastic',
		description: 'Query Elastic for package risk signals and migration patterns',
		inputSchema: {
			type: 'object',
			properties: {
				package_name: { type: 'string' },
				query_type: { type: 'string', enum: ['signals', 'alternatives', 'trends', 'health', 'intelligence'] },
			},
			required: ['package_name'],
		},
	},
	{
		name: 'create_gitlab_mr',
		description: 'Create GitLab MR for dependency migration',
		inputSchema: {
			type: 'object',
			properties: {
				repo: { type: 'string' },
				from_pkg: { type: 'string' },
				to_pkg: { type: 'string' },
				job_id: { type: 'string' },
			},
			required: ['repo', 'from_pkg', 'to_pkg'],
		},
	},
	{
		name: 'create_github_pr',
		description: 'Create GitHub PR for dependency migration',
		inputSchema: {
			type: 'object',
			properties: {
				owner: { type: 'string' },
				repo: { type: 'string' },
				from_pkg: { type: 'string' },
				to_pkg: { type: 'string' },
				job_id: { type: 'string' },
			},
			required: ['owner', 'repo', 'from_pkg', 'to_pkg'],
		},
	},
	{
		name: 'check_ci_status',
		description: 'Check GitLab CI pipeline status',
		inputSchema: {
			type: 'object',
			properties: { mr_url: { type: 'string' } },
			required: ['mr_url'],
		},
	},
	{
		name: 'check_github_ci_status',
		description: 'Check GitHub Actions CI status',
		inputSchema: {
			type: 'object',
			properties: { pr_url: { type: 'string' } },
			required: ['pr_url'],
		},
	},
	{
		name: 'index_alternative',
		description: 'Record a recommended replacement package and migration pattern in Elastic for community intelligence',
		inputSchema: {
			type: 'object',
			properties: {
				package_name: { type: 'string' },
				alternative_package: { type: 'string' },
				reason: { type: 'string' },
				ecosystem: { type: 'string' },
			},
			required: ['package_name', 'alternative_package', 'reason'],
		},
	},
	{
		name: 'transform_file',
		description: 'Use AI to intelligently migrate code from one package to another, handling API differences',
		inputSchema: {
			type: 'object',
			properties: {
				file_path: { type: 'string' },
				file_content: { type: 'string' },
				from_pkg: { type: 'string' },
				to_pkg: { type: 'string' },
				ecosystem: { type: 'string' },
			},
			required: ['file_path', 'file_content', 'from_pkg', 'to_pkg', 'ecosystem'],
		},
	},
	{
		name: 'search_scan_history',
		description: 'Search historical scan data to find risky packages across repos, get community risk intelligence',
		inputSchema: {
			type: 'object',
			properties: {
				query: { type: 'string' },
				ecosystem: { type: 'string' },
				min_risk: { type: 'string', enum: ['HIGH', 'CRITICAL'] },
			},
			required: ['query'],
		},
	},
	{
		name: 'get_risk_leaderboard',
		description: 'Get the most commonly risky packages seen across all scanned repositories',
		inputSchema: { type: 'object', properties: {} },
	},
];

const callTool = async (name: string, args: any, env: CloudflareEnv) => {
	if (name === 'query_elastic') return queryElastic(args.package_name, args.query_type ?? 'signals', env);
	if (name === 'create_gitlab_mr') return createGitLabMR(args, env);
	if (name === 'create_github_pr') return createGitHubPR(args, env);
	if (name === 'check_ci_status') return checkGitLabCI(args.mr_url, env);
	if (name === 'check_github_ci_status') return checkGitHubCI(args.pr_url, env);
	if (name === 'index_alternative') return indexAlternative(args, env);
	if (name === 'transform_file') return transformFileWithAI(args, env);
	if (name === 'search_scan_history') return searchScans(args.query, { ecosystem: args.ecosystem, minRisk: args.min_risk }, env);
	if (name === 'get_risk_leaderboard') return getGlobalRiskLeaderboard(env);

	throw new Error(`Unknown tool: ${name}`);
};

mcpRouter.post('/', async (c) => {
	const body = (await c.req.json()) as any;

	if (body.jsonrpc === '2.0') {
		const { id, method, params } = body;
		logger.info('MCP JSON-RPC', { method, id });

		if (method.startsWith('notifications/')) {
			return c.json({}, 200);
		}

		const ok = (result: unknown) => c.json({ jsonrpc: '2.0', id, result });
		const err = (code: number, message: string) => c.json({ jsonrpc: '2.0', id, error: { code, message } }, 400 as any);

		try {
			if (method === 'initialize') {
				return ok({
					protocolVersion: '2024-11-05',
					capabilities: { tools: {} },
					serverInfo: { name: 'depshield-mcp', version: '1.0.0' },
				});
			}

			if (method === 'tools/list') {
				return ok({ tools: TOOLS });
			}

			if (method === 'tools/call') {
				const { name, arguments: args } = params;
				logger.info('MCP tool call', { name, args });
				const result = await callTool(name, args, c.env);
				return ok({ content: [{ type: 'text', text: JSON.stringify(result) }] });
			}

			return err(-32601, `Unknown method: ${method}`);
		} catch (e) {
			return err(-32603, e instanceof Error ? e.message : 'Internal error');
		}
	}

	const { tool, input } = body;
	logger.info('MCP tool called (legacy)', { tool });

	try {
		const result = await callTool(tool, input, c.env);
		return c.json({ success: true, result });
	} catch (err) {
		logger.error('MCP tool failed', err, { tool });
		return c.json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
	}
});
