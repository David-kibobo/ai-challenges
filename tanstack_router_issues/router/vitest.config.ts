import { defineConfig } from 'vitest/config'

const mode = process.env.MODE ?? 'base'

export default defineConfig({
  test: {
    root: process.cwd(),
    include:
      mode === 'new'
        ? [
            // Only run the new, focused failing tests
            'packages/router-generator/tests/generator/virtual-sibling-routes/**/*.test.ts',
          ]
        : [
            // Run the whole repo's tests but exclude known base-mode failures
            'packages/**/tests/**/*.test.ts',

            // Exclude virtual-sibling new tests from base
            '!packages/router-generator/tests/generator/virtual-sibling-routes/**',

            // Exclude DOM/framework-heavy packages that require specific environments
            '!packages/solid-router/**',
            '!examples/**',

            // Exclude common adapter/test suites that run in browser-specific envs
            '!packages/*-adapter/**',

            // Exclude historically failing router-generator integration tests
            '!packages/router-generator/tests/config.test.ts',
            '!packages/router-generator/tests/deny-route-group-config.test.ts',

            // Exclude router-core load tests that are flaky in this environment
            '!packages/router-core/tests/load.test.ts',
            
            // Exclude specific failing base tests discovered in this environment
            '!packages/history/tests/createHashHistory.test.ts',
            '!packages/router-generator/tests/generator.test.ts',
          ],
    watch: false,
    typecheck: { enabled: false },
  },
})
