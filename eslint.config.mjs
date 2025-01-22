import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config({
    plugins: {
        '@typescript-eslint': tseslint.plugin,
    },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
        "@typescript-eslint/no-floating-promises": "error"
    },
    files: ["**/*.ts"]
})
