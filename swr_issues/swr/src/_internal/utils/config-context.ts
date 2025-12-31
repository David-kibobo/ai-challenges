// 'use client'

// import type { FC, PropsWithChildren } from 'react'
// import {
//   createContext,
//   createElement,
//   useContext,
//   useMemo,
//   useRef
// } from 'react'
// import { cache as defaultCache } from './config'
// import { initCache } from './cache'
// import { mergeConfigs } from './merge-config'
// import { UNDEFINED, mergeObjects, isFunction } from './shared'
// import { useIsomorphicLayoutEffect } from './env'
// import type { SWRConfiguration, FullConfiguration, Cache } from '../types'

// export const SWRConfigContext = createContext<Partial<FullConfiguration>>({})

// // Minimal helper to handle fallback materialization logic
// const materializeFallbackCache = (
//   cacheInstance: Cache,
//   fallbackData: Record<string, any>,
//   parentConfig: Partial<FullConfiguration>,
//   cacheContext: ReturnType<typeof initCache> | typeof UNDEFINED
// ) => {
//   // Hydrate if a new cache instance was created or we are the root config
//   const shouldHydrate = !!cacheContext || Object.keys(parentConfig).length === 0

//   if (shouldHydrate) {
//     for (const key in fallbackData) {
//       if (Object.prototype.hasOwnProperty.call(fallbackData, key)) {
//         if (!cacheInstance.get(key)) {
//           const data = fallbackData[key]
//           // Exclude function types to match SWR serialization rules
//           if (typeof data !== 'function') {
//             cacheInstance.set(key, {
//               data,
//               error: UNDEFINED,
//               _k: key
//             } as any)
//           }
//         }
//       }
//     }
//   }
// }

// const SWRConfig: FC<
//   PropsWithChildren<{
//     value?:
//       | SWRConfiguration
//       | ((parentConfig?: SWRConfiguration) => SWRConfiguration)
//   }>
// > = props => {
//   const { value } = props
//   const parentConfig = useContext(SWRConfigContext)
//   const isFunctionalConfig = isFunction(value)
//   const config = useMemo(
//     () => (isFunctionalConfig ? value(parentConfig) : value),
//     [isFunctionalConfig, parentConfig, value]
//   )
//   // Extend parent context values and middleware.
//   const extendedConfig = useMemo(
//     () => (isFunctionalConfig ? config : mergeConfigs(parentConfig, config)),
//     [isFunctionalConfig, parentConfig, config]
//   )

//   // Should not use the inherited provider.
//   const provider = config && config.provider

//   // initialize the cache only on first access.
//   const cacheContextRef = useRef<ReturnType<typeof initCache>>(UNDEFINED)
//   if (provider && !cacheContextRef.current) {
//     cacheContextRef.current = initCache(
//       provider((extendedConfig as any).cache || defaultCache),
//       config
//     )
//   }
//   const cacheContext = cacheContextRef.current

//   // Override the cache if a new provider is given.
//   if (cacheContext) {
//     ;(extendedConfig as any).cache = cacheContext[0]
//     ;(extendedConfig as any).mutate = cacheContext[1]
//   }

//   // Materialize fallback data.
//   // NOTE: This side effect is intentionally placed in useMemo to guarantee the cache is
//   // populated synchronously during the render phase. This ensures the initial state
//   // is available before any child component's useSWR hook attempts to read the cache,
//   // satisfying SWR's synchronous initialization contract.
//   useMemo(() => {
//     const cacheInstance =
//       (cacheContext && cacheContext[0]) ||
//       (extendedConfig as any).cache ||
//       defaultCache
//     const fallbackData = extendedConfig?.fallback || {}

//     materializeFallbackCache(
//       cacheInstance as Cache,
//       fallbackData,
//       parentConfig,
//       cacheContext
//     )
//   }, [cacheContext, extendedConfig?.fallback, parentConfig])

//   // Unsubscribe events.
//   useIsomorphicLayoutEffect(() => {
//     if (cacheContext) {
//       // eslint-disable-next-line @typescript-eslint/no-unused-expressions
//       cacheContext[2] && cacheContext[2]()
//       return cacheContext[3]
//     }
//   }, [])

//   return createElement(
//     SWRConfigContext.Provider,
//     mergeObjects(props, {
//       value: extendedConfig
//     })
//   )
// }

// export default SWRConfig

'use client'

import type { FC, PropsWithChildren } from 'react'
import {
  createContext,
  createElement,
  useContext,
  useMemo,
  useRef
} from 'react'
import { cache as defaultCache } from './config'
import { initCache } from './cache'
import { mergeConfigs } from './merge-config'
import { UNDEFINED, mergeObjects, isFunction } from './shared'
import { useIsomorphicLayoutEffect } from './env'
import type { SWRConfiguration, FullConfiguration } from '../types'

export const SWRConfigContext = createContext<Partial<FullConfiguration>>({})

const SWRConfig: FC<
  PropsWithChildren<{
    value?:
      | SWRConfiguration
      | ((parentConfig?: SWRConfiguration) => SWRConfiguration)
  }>
> = props => {
  const { value } = props
  const parentConfig = useContext(SWRConfigContext)
  const isFunctionalConfig = isFunction(value)
  const config = useMemo(
    () => (isFunctionalConfig ? value(parentConfig) : value),
    [isFunctionalConfig, parentConfig, value]
  )
  // Extend parent context values and middleware.
  const extendedConfig = useMemo(
    () => (isFunctionalConfig ? config : mergeConfigs(parentConfig, config)),
    [isFunctionalConfig, parentConfig, config]
  )

  // Should not use the inherited provider.
  const provider = config && config.provider

  // initialize the cache only on first access.
  const cacheContextRef = useRef<ReturnType<typeof initCache>>(UNDEFINED)
  if (provider && !cacheContextRef.current) {
    cacheContextRef.current = initCache(
      provider((extendedConfig as any).cache || defaultCache),
      config
    )
  }
  const cacheContext = cacheContextRef.current

  // Override the cache if a new provider is given.
  if (cacheContext) {
    ;(extendedConfig as any).cache = cacheContext[0]
    ;(extendedConfig as any).mutate = cacheContext[1]
  }

  // Unsubscribe events.
  useIsomorphicLayoutEffect(() => {
    if (cacheContext) {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      cacheContext[2] && cacheContext[2]()
      return cacheContext[3]
    }
  }, [])

  return createElement(
    SWRConfigContext.Provider,
    mergeObjects(props, {
      value: extendedConfig
    })
  )
}

export default SWRConfig
