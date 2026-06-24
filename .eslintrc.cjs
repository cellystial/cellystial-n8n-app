module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { sourceType: 'module', extraFileExtensions: ['.json'] },
  ignorePatterns: ['.eslintrc.cjs','**/*.js','node_modules/**','dist/**','**/__tests__/**'],
  overrides: [
    { files: ['package.json'], plugins: ['eslint-plugin-n8n-nodes-base'], extends: ['plugin:n8n-nodes-base/community'] },
    { files: ['credentials/**/*.ts'], plugins: ['eslint-plugin-n8n-nodes-base'], extends: ['plugin:n8n-nodes-base/credentials'] },
    { files: ['nodes/**/*.ts'], plugins: ['eslint-plugin-n8n-nodes-base'], extends: ['plugin:n8n-nodes-base/nodes'] },
  ],
};
