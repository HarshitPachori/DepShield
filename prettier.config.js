const config = {
	// General
	semi: true,
	singleQuote: true,
	tabWidth: 2,
	useTabs: false,
	trailingComma: 'all',
	printWidth: 100,
	endOfLine: 'lf',

	// JSX / React
	jsxSingleQuote: false,

	// Formatting behavior
	bracketSpacing: true,
	arrowParens: 'always',

	// Tailwind class sorting (if using Tailwind)
	plugins: ['prettier-plugin-tailwindcss'],

	// File-specific overrides
	overrides: [
		{
			files: '*.json',
			options: {
				printWidth: 80,
			},
		},
		{
			files: '*.css',
			options: {
				singleQuote: false,
			},
		},
	],
};

export default config;
