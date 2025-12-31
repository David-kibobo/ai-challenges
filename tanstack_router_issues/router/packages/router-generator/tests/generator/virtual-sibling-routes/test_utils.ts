import fs from 'node:fs/promises'
import { join, dirname } from 'node:path'

export interface FixtureFile {
  path: string
  routeId: string
  routePath: string
  isOutlet?: boolean
  children?: FixtureFile[]
}

export function generateComponent(f: FixtureFile): string {
  const outlet = f.isOutlet ? `<Outlet />` : ``

  return `
import * as React from 'react'
import { ${f.isOutlet ? 'Outlet, ' : ''}createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('${f.routePath}')({
  component: () => (
    <>
      <div>${f.routeId}</div>
      ${outlet}
    </>
  ),
})
  `.trim()
}

/**
 * Recursively create fixture files, preserving __root.tsx
 */
export async function createFixtureFiles(
  testDir: string,
  fixtures: FixtureFile[],
  parentDir = 'routes',
) {
  const routesDir = join(testDir, parentDir)

  // Ensure routesDir exists (do not delete __root.tsx)
  await fs.mkdir(routesDir, { recursive: true })

  // Recursive helper
  async function writeFixtures(fixs: FixtureFile[], baseDir: string) {
    for (const f of fixs) {
      const routeParts = f.routePath.startsWith('/')
        ? f.routePath.slice(1).split('/')
        : f.routePath.split('/')
      const filePath = join(baseDir, ...routeParts) + '.tsx'

      // Skip overwriting __root.tsx if user provides it
      if (filePath.endsWith('__root.tsx')) continue

      await fs.mkdir(dirname(filePath), { recursive: true })
      await fs.writeFile(filePath, generateComponent(f), 'utf8')

      if (f.children?.length) {
        await writeFixtures(f.children, baseDir)
      }
    }
  }

  await writeFixtures(fixtures, routesDir)
}
