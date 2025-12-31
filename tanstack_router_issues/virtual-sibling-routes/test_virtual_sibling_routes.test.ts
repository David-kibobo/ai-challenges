// import { it, expect } from 'vitest'
// import fs from 'node:fs/promises'
// import { join, dirname } from 'node:path'
// import { Generator, getConfig } from '../../../src'

// function makeFolderDir(folder: string) {
//   return join(process.cwd(), 'packages', 'router-generator', 'tests', 'generator', folder)
// }

// async function ensureFixtureFilesExist(folder: string) {
//   const routesDir = join(folder, 'routes')
//   const files = ['root.tsx', 'index.tsx', 'postsLayout.tsx', 'posts.tsx', 'posts-id.tsx']

//   await fs.mkdir(routesDir, { recursive: true })

//   await Promise.all(
//     files.map(async (f) => {
//       const filePath = join(routesDir, f)
//       try {
//         await fs.access(filePath)
//       } catch {
//         await fs.writeFile(filePath, 'export default () => null\n', 'utf-8')
//       }
//     }),
//   )
// }

// async function setupTest() {
//   const testDir = makeFolderDir('virtual-sibling-routes')
//   await ensureFixtureFilesExist(testDir)

//   const config = getConfig({
//     disableLogging: true,
//     routesDirectory: join(testDir, 'routes'),
//     generatedRouteTree: join(testDir, 'routeTree.gen.ts'),
//     virtualRouteConfig: './routes/root.tsx',
//     experimental: { nonNestedRoutes: false },
//   })

//   const generator = new Generator({ config, root: testDir })
//   await generator.run()

//   const generatedRouteTree = await fs.readFile(join(testDir, 'routeTree.gen.ts'), 'utf-8')
//   return { generatedRouteTree, config }
// }



// it('should preserve explicit sibling relationships in virtual route config', async () => {
//   const { generatedRouteTree } = await setupTest()

//   const postsRouteMatch = generatedRouteTree.match(
//     /const\s+(\w+Route)\s*=\s*\w+RouteImport\.update\([^}]*path:\s*['"]\/posts['"][^}]*getParentRoute:\s*\(\)\s*=>\s*(\w+Route)[^}]*\}/s
//   )
//   expect(postsRouteMatch).not.toBeNull()
//   const postsParent = postsRouteMatch?.[2]
//   expect(postsParent).toBe('postsLayoutRoute')

//   const postsIdRouteMatch = generatedRouteTree.match(
//     /const\s+postsIdRoute\s*=\s*postsIdRouteImport\.update\([^}]*path:\s*['"]\/\$id['"][^}]*getParentRoute:\s*\(\)\s*=>\s*(\w+Route)[^}]*\}/s
//   )
//   expect(postsIdRouteMatch).not.toBeNull()
//   const postsIdParent = postsIdRouteMatch?.[1]
//   expect(postsIdParent).toBe('postsLayoutRoute')
//   expect(postsIdParent).not.toBe('postsRoute')

//   const postsRouteChildrenMatch = generatedRouteTree.match(
//     /interface\s+\w+RouteChildren\s*\{[^}]*postsIdRoute[^}]*\}/s
//   )
//   if (postsRouteChildrenMatch) {
//     const parentRouteName = postsRouteChildrenMatch[0].match(/interface\s+(\w+Route)Children/)?.[1]
//     expect(parentRouteName).not.toBe('postsRoute')
//   }

//   const postsLayoutRouteChildrenMatch = generatedRouteTree.match(
//     /interface\s+postsLayoutRouteChildren\s*\{[^}]*\}/s
//   )
//   expect(postsLayoutRouteChildrenMatch).not.toBeNull()
//   if (postsLayoutRouteChildrenMatch) {
//     const childrenContent = postsLayoutRouteChildrenMatch[0]
//     expect(childrenContent).toMatch(/posts\w*Route:/)
//     expect(childrenContent).toMatch(/postsId\w*Route:/)
//   }
// })

// it('should correctly set parent route for /posts route', async () => {
//   const { generatedRouteTree } = await setupTest()
//   const postsRouteMatch = generatedRouteTree.match(
//     /const\s+(\w+Route)\s*=\s*\w+RouteImport\.update\([^}]*path:\s*['"]\/posts['"][^}]*getParentRoute:\s*\(\)\s*=>\s*(\w+Route)[^}]*\}/s
//   )
//   expect(postsRouteMatch).not.toBeNull()
//   const parentRoute = postsRouteMatch?.[2]
//   expect(parentRoute).toBe('postsLayoutRoute')
// })

// it('should correctly set parent route for /posts/$id route', async () => {
//   const { generatedRouteTree } = await setupTest()
//   const postsIdRouteMatch = generatedRouteTree.match(
//     /const\s+postsIdRoute\s*=\s*postsIdRouteImport\.update\([^}]*path:\s*['"]\/\$id['"][^}]*getParentRoute:\s*\(\)\s*=>\s*(\w+Route)[^}]*\}/s
//   )
//   expect(postsIdRouteMatch).not.toBeNull()
//   const parentRoute = postsIdRouteMatch?.[1]
//   expect(parentRoute).toBe('postsLayoutRoute')
//   expect(parentRoute).not.toBe('postsRoute')
// })

// it('should not create parent-child relationship between /posts and /posts/$id', async () => {
//   const { generatedRouteTree } = await setupTest()
//   const postsRouteChildrenPattern = /interface\s+postsRouteChildren\s*\{[^}]*\}/
//   const match = generatedRouteTree.match(postsRouteChildrenPattern)
//   if (match) expect(match[0]).not.toContain('postsIdRoute')

//   const layoutChildrenPattern = /interface\s+postsLayoutRouteChildren\s*\{[^}]*\}/
//   const layoutMatch = generatedRouteTree.match(layoutChildrenPattern)
//   expect(layoutMatch).not.toBeNull()
//   if (layoutMatch) {
//     expect(layoutMatch[0]).toContain('postsRoute')
//     expect(layoutMatch[0]).toContain('postsIdRoute')
//   }
// })

// it('should handle multiple sibling routes with path prefix similarity', async () => {
//   const { generatedRouteTree } = await setupTest()
//   const layoutChildrenCount = (generatedRouteTree.match(/postsLayoutRouteChildren\s*=\s*\{/g) || []).length
//   expect(layoutChildrenCount).toBeGreaterThan(0)
// })


// import { describe, it, expect } from 'vitest'
// import { rootRoute, route, index, layout } from '@tanstack/virtual-file-routes'

// describe('Generator virtual routes: explicit sibling relationships (issue #5822)', () => {
//   const routeTree = rootRoute('root.tsx', [
//     layout('root-layout.tsx', [
//       route('/posts', 'posts.tsx', [index('posts-index.tsx')]),
//       route('/posts/$id', 'posts-id.tsx'), // sibling, not nested
//       route('/posts/comments', 'posts-comments.tsx'), // for prefix similarity test
//     ]),
//   ])
//    console.log('Generated Route Tree:', JSON.stringify(routeTree, null, 2));
//   const layoutNode = routeTree.children?.[0]
//   if (!layoutNode?.children) {
//     throw new Error('Virtual route tree is missing expected children')
//   }
//   const layoutChildren = layoutNode.children

//   it('preserves explicit sibling relationships: all sibling routes share the same parent array', () => {
//     const posts = layoutChildren.find(r => r.path === '/posts')
//     const postsId = layoutChildren.find(r => r.path === '/posts/$id')
//     const postsComments = layoutChildren.find(r => r.path === '/posts/comments')

//     expect(posts).toBeDefined()
//     expect(postsId).toBeDefined()
//     expect(postsComments).toBeDefined()

//     // Parent is the layoutChildren array itself
//     expect(layoutChildren).toContain(posts)
//     expect(layoutChildren).toContain(postsId)  // ❌ should fail if posts/$id is nested
//     expect(layoutChildren).toContain(postsComments)
//   })

//   it('does NOT create parent-child relationship between /posts and /posts/$id', () => {
//     const posts = layoutChildren.find(r => r.path === '/posts')
//     const postsId = layoutChildren.find(r => r.path === '/posts/$id')

//     expect(posts).toBeDefined()
//     expect(postsId).toBeDefined()

//     // /posts/$id should NOT appear in /posts children
//     expect(posts!.children).not.toContain(postsId)
//   })

//   it('ensures /posts and /posts/$id are siblings in the layout array', () => {
//     const posts = layoutChildren.find(r => r.path === '/posts')
//     const postsId = layoutChildren.find(r => r.path === '/posts/$id')
    
//     expect(posts).toBeDefined()
//     expect(postsId).toBeDefined()

//     // Both must appear in the same layoutChildren array
//     const siblingRoutes = layoutChildren
//     expect(siblingRoutes.indexOf(posts)).toBeLessThan(siblingRoutes.length)
//     expect(siblingRoutes.indexOf(postsId)).toBeLessThan(siblingRoutes.length)
//   })

//   it('handles multiple sibling routes with prefix similarity', () => {
//     const postsId = layoutChildren.find(r => r.path === '/posts/$id')
//     const postsComments = layoutChildren.find(r => r.path === '/posts/comments')

//     expect(postsId).toBeDefined()
//     expect(postsComments).toBeDefined()

//     expect(layoutChildren).toContain(postsId)
//     expect(layoutChildren).toContain(postsComments)
//   })

//   it('retains children for /posts but does not nest /posts/$id', () => {
//     const posts = layoutChildren.find(r => r.path === '/posts')
//     const postsId = layoutChildren.find(r => r.path === '/posts/$id')

//     expect(posts).toBeDefined()
//     expect(postsId).toBeDefined()

//     expect(posts!.children?.length).toBeGreaterThan(0)
//     expect(posts!.children).not.toContain(postsId)
//   })
// })


// packages/router-generator/tests/generator/virtual-sibling-routes/test_virtual_sibling_routes.test.ts
// packages/router-generator/tests/generator/virtual-sibling-routes/test_virtual_sibling_routes.test.ts
import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'url'
import { Generator, getConfig } from '../../../src'
import { createFixtureFiles, FixtureFile } from './test_utils'

import { createRootRoute, createRoute } from '@tanstack/react-router'

function makeDir(folder: string) {
  return join(
    process.cwd(),
    'packages',
    'router-generator',
    'tests',
    'generator',
    folder,
  )
}

function normalize(node: any): any {
  if (!node) return null

  const id =
    node.id ??
    node._id ??
    node.routeId ??
    (typeof node.getId === 'function' ? node.getId() : null)

  const path =
    node.path ??
    node._path ??
    node.routePath ??
    (typeof node.getPath === 'function' ? node.getPath() : null)

  let children =
    node.children ??
    node._children ??
    (typeof node.getChildren === 'function' ? node.getChildren() : [])

  if (children == null) {
    children = []
  } else if (!Array.isArray(children)) {
    children = Object.values(children)
  }

  return {
    id: typeof id === 'string' ? id : id ?? null,
    __raw: node,
    path: typeof path === 'string' ? path : path ?? null,
    children: Array.isArray(children) ? children.map((c: any) => normalize(c)) : [],
  }
}

interface RouteNode {
  id: string | null
  path: string | null
  children: RouteNode[]
  getParentRoute?: () => RouteNode | null
}

function normalizeTree(root: RouteNode): RouteNode {
  const seen = new WeakSet<RouteNode>()

  function attachChildren(node: RouteNode) {
    if (!node || seen.has(node)) return
    seen.add(node)

    try {
      if (typeof (node as any).__raw?.getParentRoute === 'function') {
        const parent = (node as any).__raw.getParentRoute()
        if (parent) {
          const parentNorm = findByRaw(root as any, parent)
          if (parentNorm && !parentNorm.children.some((c: any) => c.__raw === node.__raw)) {
            parentNorm.children.push(node as any)
          }
        }
      }
    } catch {}

    node.children.forEach(attachChildren)
  }

  function findByRaw(rootNode: any, raw: any): any | null {
    let found: any = null
    const seenLocal = new WeakSet<any>()
    function dfs(n: any) {
      if (!n || seenLocal.has(n)) return
      seenLocal.add(n)
      if (n.__raw === raw) {
        found = n
        return
      }
      for (const c of n.children ?? []) dfs(c)
    }
    dfs(rootNode)
    return found
  }

  attachChildren(root)
  return root
}

function topLevelChildren(root: any) {
  return (root?.children ?? []) as any[]
}

function topLevelPaths(tree: any) {
  return (tree?.children ?? [])
    .map((c: any) => c.path ?? c._path ?? (c.getPath?.() ?? null))
    .filter(Boolean)
}

async function importGeneratedModule(filePath: string) {
  const url = pathToFileURL(filePath).href + `?t=${Date.now()}`
  return import(url)
}

async function generateCodegenTree(fixtures: FixtureFile[]) {
  const testDir = makeDir('virtual-sibling-routes')
  const routesDir = join(testDir, 'routes')
  await fs.mkdir(routesDir, { recursive: true })

  const rootFile = join(routesDir, '__root.tsx')
  try {
    await fs.access(rootFile)
  } catch {
    await fs.writeFile(
      rootFile,
      `
import * as React from 'react'
import { createRootRoute, Outlet } from '@tanstack/react-router'

export const Route = createRootRoute({
  component: () => <Outlet />,
})
`.trim(),
      'utf8',
    )
  }

  await createFixtureFiles(testDir, fixtures)

  const config = getConfig(
    {
      disableLogging: true,
      routesDirectory: routesDir,
      generatedRouteTree: join(testDir, 'routeTree.gen.ts'),
    },
    testDir,
  )

  const generator = new Generator({ config, root: testDir })
  await generator.run()

  const generatedSource = await fs.readFile(config.generatedRouteTree, 'utf8')
  const module = await importGeneratedModule(config.generatedRouteTree)

  const normalized = normalize(module.routeTree)
  const attached = normalizeTree(normalized as any)

  return { codegenTree: attached, generatedSource, testDir }
}
function getPath(route: any): string | null {
  return (
    route.path ??                    // top-level path
    route.options?.path ??           // options.path if available
    route.__raw?.options?.path ??    // raw route fallback
    null
  )
}
function buildPublicApiTree() {
  const root = createRootRoute()
  const posts = createRoute({ path: '/posts', getParentRoute: () => root })
  const postId = createRoute({ path: '/posts/$id', getParentRoute: () => root })
  const comments = createRoute({ path: '/posts/comments', getParentRoute: () => root })
  root.addChildren([posts, postId, comments])
  return root
}

// Fixtures
const siblingFixtures: FixtureFile[] = [
  { path: 'posts', routeId: 'posts', routePath: '/posts', isOutlet: false },
  { path: 'posts-id', routeId: 'posts-id', routePath: '/posts/$id' },
  { path: 'posts-comments', routeId: 'posts-comments', routePath: '/posts/comments' },
]

const nestedFixtures: FixtureFile[] = [
  {
    path: 'posts',
    routeId: 'posts',
    routePath: '/posts',
    isOutlet: true,
    children: [
      { path: 'posts/id', routeId: 'posts-id', routePath: '/posts/$id' },
      { path: 'posts/comments', routeId: 'posts-comments', routePath: '/posts/comments' },
    ],
  },
]

// --- Shared variables for all tests ---
let codegenTree: any
let generatedSource: string



beforeAll(async () => {
  const result = await generateCodegenTree(siblingFixtures)
  codegenTree = result.codegenTree
  generatedSource = result.generatedSource
})

describe('virtual sibling routes (issue #5822) — strict structure checks', () => {
  it('codegen tree deep equality should match public API tree (detect nesting bugs)', () => {
    const publicTree = buildPublicApiTree()
    const normalizedPublic = normalize(publicTree)
    const normalizedPublicAttached = normalizeTree(normalizedPublic as any)

    try {
      expect(codegenTree).toEqual(normalizedPublicAttached)
    } catch (err) {
      console.log('--- GENERATED SOURCE (snippet) ---')
      console.log(generatedSource.slice(0, 2000))
      console.log('top-level paths:', topLevelChildren(codegenTree).map(getPath))
      console.log('--- PUBLIC API TREE ---')
      console.log(JSON.stringify(normalizedPublicAttached, null, 2))
      console.log('--- CODEGEN TREE ---')
      console.log(JSON.stringify(codegenTree, null, 2))
      throw err
    }
  })

  it('root must have exact sibling children at top-level (no nesting allowed)', () => {
    const publicTree = buildPublicApiTree()
    const normalizedPublic = normalize(publicTree)
    const normalizedPublicAttached = normalizeTree(normalizedPublic as any)

    const codegenTop = topLevelChildren(codegenTree)
    const publicTop = topLevelChildren(normalizedPublicAttached)

    expect(codegenTop.length).toBe(publicTop.length)
    expect(codegenTop.every((c: any) => typeof getPath(c) === 'string' && getPath(c)!.length > 0)).toBe(true)

    const publicPaths = publicTop.map(getPath)
    const rootPaths = codegenTop.map(getPath)
    publicPaths.forEach((p) => expect(rootPaths).toContain(p))

    const postsNode = codegenTop.find((c: any) => getPath(c) === '/posts')
    expect(postsNode).toBeDefined()
    const postsChildrenPaths = (postsNode?.children ?? []).map(getPath)
    expect(postsChildrenPaths).not.toContain('/posts/$id')
    expect(postsChildrenPaths).not.toContain('/posts/comments')
  })
})

describe('virtual sibling routes – additional edge cases (strict)', () => {
  it('handles similar prefixes without nesting (root children are immediate)', () => {
    const rootChildren = topLevelChildren(codegenTree)
    expect(rootChildren.length).toBe(3)
    expect(rootChildren.every((c: any) => typeof getPath(c) === 'string' && getPath(c)!.length > 0)).toBe(true)

    const rootPaths = rootChildren.map(getPath)
    console.log('Root paths:', rootPaths)
    expect(rootPaths).toContain('/posts')
    expect(rootPaths).toContain('/posts/$id')
    expect(rootPaths).toContain('/posts/comments')

    const posts = rootChildren.find((c: any) => getPath(c) === '/posts')
    expect(posts).toBeDefined()
    expect((posts?.children ?? []).map(getPath)).not.toContain('/posts/$id')
  })

  it('dynamic routes remain siblings with static routes (immediate)', async () => {
    const fixtures: FixtureFile[] = [
      { path: 'products', routeId: 'products', routePath: '/products', isOutlet: false },
      { path: 'product-id', routeId: 'product-id', routePath: '/products/$id' },
    ]
    
    const { codegenTree: dynTree } = await generateCodegenTree(fixtures)
    const rootChildren = topLevelChildren(dynTree)
    expect(rootChildren.length).toBe(2)
    expect(rootChildren.map(getPath)).toEqual(
      expect.arrayContaining(['/products', '/products/$id'])
    )
  })

  it.skip('nested fixtures produce nested children (sanity for nested case)', async () => {
    const { codegenTree: nestedTree } = await generateCodegenTree(nestedFixtures)
    const rootChildren = topLevelChildren(nestedTree)
    expect(rootChildren.length).toBeGreaterThanOrEqual(1)
    const posts = rootChildren.find((c: any) => getPath(c) === '/posts')
    expect(posts).toBeDefined()
    const postsChildPaths = (posts?.children ?? []).map(getPath)
    expect(postsChildPaths).toContain('/posts/$id')
    expect(postsChildPaths).toContain('/posts/comments')
  })
})
