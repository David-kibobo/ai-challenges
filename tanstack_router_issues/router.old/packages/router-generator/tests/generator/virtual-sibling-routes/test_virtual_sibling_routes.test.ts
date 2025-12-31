import { it, expect } from 'vitest'
import fs from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { Generator, getConfig } from '../../../src'

function makeFolderDir(folder: string) {
  return join(process.cwd(), 'packages', 'router-generator', 'tests', 'generator', folder)
}

async function ensureFixtureFilesExist(folder: string) {
  const routesDir = join(folder, 'routes')
  const files = ['root.tsx', 'index.tsx', 'postsLayout.tsx', 'posts.tsx', 'posts-id.tsx']

  await fs.mkdir(routesDir, { recursive: true })

  await Promise.all(
    files.map(async (f) => {
      const filePath = join(routesDir, f)
      try {
        await fs.access(filePath)
      } catch {
        await fs.writeFile(filePath, 'export default () => null\n', 'utf-8')
      }
    }),
  )
}

async function setupTest() {
  const testDir = makeFolderDir('virtual-sibling-routes')
  await ensureFixtureFilesExist(testDir)

  const config = getConfig({
    disableLogging: true,
    routesDirectory: join(testDir, 'routes'),
    generatedRouteTree: join(testDir, 'routeTree.gen.ts'),
    virtualRouteConfig: './routes/root.tsx',
    experimental: { nonNestedRoutes: false },
  })

  const generator = new Generator({ config, root: testDir })
  await generator.run()

  const generatedRouteTree = await fs.readFile(join(testDir, 'routeTree.gen.ts'), 'utf-8')
  return { generatedRouteTree, config }
}



it('should preserve explicit sibling relationships in virtual route config', async () => {
  const { generatedRouteTree } = await setupTest()

  const postsRouteMatch = generatedRouteTree.match(
    /const\s+(\w+Route)\s*=\s*\w+RouteImport\.update\([^}]*path:\s*['"]\/posts['"][^}]*getParentRoute:\s*\(\)\s*=>\s*(\w+Route)[^}]*\}/s
  )
  expect(postsRouteMatch).not.toBeNull()
  const postsParent = postsRouteMatch?.[2]
  expect(postsParent).toBe('postsLayoutRoute')

  const postsIdRouteMatch = generatedRouteTree.match(
    /const\s+postsIdRoute\s*=\s*postsIdRouteImport\.update\([^}]*path:\s*['"]\/\$id['"][^}]*getParentRoute:\s*\(\)\s*=>\s*(\w+Route)[^}]*\}/s
  )
  expect(postsIdRouteMatch).not.toBeNull()
  const postsIdParent = postsIdRouteMatch?.[1]
  expect(postsIdParent).toBe('postsLayoutRoute')
  expect(postsIdParent).not.toBe('postsRoute')

  const postsRouteChildrenMatch = generatedRouteTree.match(
    /interface\s+\w+RouteChildren\s*\{[^}]*postsIdRoute[^}]*\}/s
  )
  if (postsRouteChildrenMatch) {
    const parentRouteName = postsRouteChildrenMatch[0].match(/interface\s+(\w+Route)Children/)?.[1]
    expect(parentRouteName).not.toBe('postsRoute')
  }

  const postsLayoutRouteChildrenMatch = generatedRouteTree.match(
    /interface\s+postsLayoutRouteChildren\s*\{[^}]*\}/s
  )
  expect(postsLayoutRouteChildrenMatch).not.toBeNull()
  if (postsLayoutRouteChildrenMatch) {
    const childrenContent = postsLayoutRouteChildrenMatch[0]
    expect(childrenContent).toMatch(/posts\w*Route:/)
    expect(childrenContent).toMatch(/postsId\w*Route:/)
  }
})

it('should correctly set parent route for /posts route', async () => {
  const { generatedRouteTree } = await setupTest()
  const postsRouteMatch = generatedRouteTree.match(
    /const\s+(\w+Route)\s*=\s*\w+RouteImport\.update\([^}]*path:\s*['"]\/posts['"][^}]*getParentRoute:\s*\(\)\s*=>\s*(\w+Route)[^}]*\}/s
  )
  expect(postsRouteMatch).not.toBeNull()
  const parentRoute = postsRouteMatch?.[2]
  expect(parentRoute).toBe('postsLayoutRoute')
})

it('should correctly set parent route for /posts/$id route', async () => {
  const { generatedRouteTree } = await setupTest()
  const postsIdRouteMatch = generatedRouteTree.match(
    /const\s+postsIdRoute\s*=\s*postsIdRouteImport\.update\([^}]*path:\s*['"]\/\$id['"][^}]*getParentRoute:\s*\(\)\s*=>\s*(\w+Route)[^}]*\}/s
  )
  expect(postsIdRouteMatch).not.toBeNull()
  const parentRoute = postsIdRouteMatch?.[1]
  expect(parentRoute).toBe('postsLayoutRoute')
  expect(parentRoute).not.toBe('postsRoute')
})

it('should not create parent-child relationship between /posts and /posts/$id', async () => {
  const { generatedRouteTree } = await setupTest()
  const postsRouteChildrenPattern = /interface\s+postsRouteChildren\s*\{[^}]*\}/
  const match = generatedRouteTree.match(postsRouteChildrenPattern)
  if (match) expect(match[0]).not.toContain('postsIdRoute')

  const layoutChildrenPattern = /interface\s+postsLayoutRouteChildren\s*\{[^}]*\}/
  const layoutMatch = generatedRouteTree.match(layoutChildrenPattern)
  expect(layoutMatch).not.toBeNull()
  if (layoutMatch) {
    expect(layoutMatch[0]).toContain('postsRoute')
    expect(layoutMatch[0]).toContain('postsIdRoute')
  }
})

it('should handle multiple sibling routes with path prefix similarity', async () => {
  const { generatedRouteTree } = await setupTest()
  const layoutChildrenCount = (generatedRouteTree.match(/postsLayoutRouteChildren\s*=\s*\{/g) || []).length
  expect(layoutChildrenCount).toBeGreaterThan(0)
})
