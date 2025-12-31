// We have to several type castings here because `useSWRInfinite` is a special
// hook where `key` and return type are not like the normal `useSWR` types.

import { useRef, useCallback, useState } from 'react'
import type { SWRConfig } from '../index'
import useSWR from '../index'
import {
  isUndefined,
  isFunction,
  UNDEFINED,
  createCacheHelper,
  useIsomorphicLayoutEffect,
  serialize,
  withMiddleware,
  INFINITE_PREFIX,
  SWRGlobalState,
  cache as defaultCache
} from '../_internal'
import type {
  BareFetcher,
  SWRHook,
  MutatorCallback,
  Middleware,
  GlobalState
} from '../_internal'
import type {
  SWRInfiniteConfiguration,
  SWRInfiniteResponse,
  SWRInfiniteHook,
  SWRInfiniteKeyLoader,
  SWRInfiniteFetcher,
  SWRInfiniteCacheValue,
  SWRInfiniteCompareFn,
  SWRInfiniteKeyedMutator,
  SWRInfiniteMutatorOptions
} from './types'
import { useSyncExternalStore } from 'use-sync-external-store/shim'
import { getFirstPageKey } from './serialize'

const EMPTY_PROMISE = Promise.resolve() as Promise<undefined>

export { unstable_serialize } from './serialize'

export const infinite = (<Data, Error>(useSWRNext: SWRHook) =>
  (
    getKey: SWRInfiniteKeyLoader,
    fn: BareFetcher<Data> | null,
    config: Omit<typeof SWRConfig.defaultValue, 'fetcher'> &
      Omit<SWRInfiniteConfiguration<Data, Error>, 'fetcher'>
  ) => {
    const didMountRef = useRef<boolean>(false)
    const {
      cache,
      initialSize = 1,
      revalidateAll = false,
      persistSize = false,
      revalidateFirstPage = true,
      revalidateOnMount = false,
      parallel = false
    } = config
    const [, , , PRELOAD] = SWRGlobalState.get(defaultCache) as GlobalState

    // The serialized key of the first page. This key will be used to store
    // metadata of this SWR infinite hook.
    let infiniteKey: string | undefined
    try {
      infiniteKey = getFirstPageKey(getKey)
      if (infiniteKey) infiniteKey = INFINITE_PREFIX + infiniteKey
    } catch (err) {
      // Not ready yet.
    }

    const [get, set, subscribeCache] = createCacheHelper<
      Data,
      SWRInfiniteCacheValue<Data, any>
    >(cache, infiniteKey)

    const getRef = useRef(get)
    const setRef = useRef(set)
    useIsomorphicLayoutEffect(() => {
      getRef.current = get
      setRef.current = set
    })

    const isExplicitSize = !isUndefined(config.initialSize)
    const [instanceId] = useState(() =>
      isExplicitSize ? '$_' + Math.random().toString(36).slice(2) : '_l'
    )

    const resolvePageSize = useCallback((): number => {
      const cachedPageSize = (getRef.current() as any)[instanceId]
      return isUndefined(cachedPageSize) ? initialSize : cachedPageSize
      // `cache` isn't allowed to change during the lifecycle
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [infiniteKey, initialSize, instanceId])

    const getSnapshot = useCallback(() => {
      return resolvePageSize()
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resolvePageSize])

    useSyncExternalStore(
      useCallback(
        (callback: () => void) => {
          if (infiniteKey)
            return subscribeCache(infiniteKey, () => {
              callback()
            })
          return () => {}
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [infiniteKey]
      ),
      getSnapshot,
      getSnapshot
    )

    // keep the last page size to restore it with the persistSize option
    const lastPageSizeRef = useRef<number>(resolvePageSize())

    // When the page key changes, we reset the page size if it's not persisted
    useIsomorphicLayoutEffect(() => {
      if (!didMountRef.current) {
        didMountRef.current = true
        return
      }

      if (infiniteKey) {
        // If the key has been changed, we keep the current page size if persistSize is enabled
        // Otherwise, we reset the page size to cached pageSize
        const nextSize = persistSize
          ? lastPageSizeRef.current
          : resolvePageSize()
        setRef.current({ [instanceId]: nextSize } as any)
      }

      // `initialSize` isn't allowed to change during the lifecycle
    }, [infiniteKey, persistSize, instanceId, resolvePageSize])

    // Needs to check didMountRef during mounting, not in the fetcher
    const shouldRevalidateOnMount = revalidateOnMount && !didMountRef.current

    // Actual SWR hook to load all pages in one fetcher.
    const swr = useSWRNext(
      infiniteKey,
      async key => {
        // get the revalidate context
        const forceRevalidateAll = getRef.current()._i
        const shouldRevalidatePage = getRef.current()._r

        // Reset flags immediately after reading
        setRef.current({ _r: UNDEFINED, _i: UNDEFINED })

        // return an array of page data
        const data: Data[] = []

        const pageSize = resolvePageSize()
        const [getCache] = createCacheHelper<
          Data,
          SWRInfiniteCacheValue<Data[], any>
        >(cache, key)
        const cacheData = getCache().data

        const revalidators = []

        let previousPageData = null
        for (let i = 0; i < pageSize; ++i) {
          const [pageKey, pageArg] = serialize(
            getKey(i, parallel ? null : previousPageData)
          )

          if (!pageKey) {
            // `pageKey` is falsy, stop fetching new pages.
            break
          }

          const [getSWRCache, setSWRCache] = createCacheHelper<
            Data,
            SWRInfiniteCacheValue<Data, any>
          >(cache, pageKey)

          // Get the cached page data.
          let pageData = getSWRCache().data as Data
          // should fetch (or revalidate) if:
          // - `revalidateAll` is enabled
          // - `mutate()` called
          // - the cache is missing
          // - it's the first page and it's not the initial render
          // - `revalidateOnMount` is enabled and it's on mount
          // - cache for that page has changed
          const shouldFetchPage =
            revalidateAll ||
            forceRevalidateAll ||
            isUndefined(pageData) ||
            (revalidateFirstPage && !i && !isUndefined(cacheData)) ||
            shouldRevalidateOnMount ||
            (cacheData &&
              !isUndefined(cacheData[i]) &&
              !config.compare(cacheData[i], pageData))
          if (
            fn &&
            (typeof shouldRevalidatePage === 'function'
              ? shouldRevalidatePage(pageData, pageArg)
              : shouldFetchPage)
          ) {
            const revalidate = async () => {
              const hasPreloadedRequest = pageKey in PRELOAD
              if (!hasPreloadedRequest) {
                pageData = await fn(pageArg)
              } else {
                const req = PRELOAD[pageKey]
                // delete the preload cache key before resolving it
                // in case there's an error
                delete PRELOAD[pageKey]
                // get the page data from the preload cache
                pageData = await req
              }
              setSWRCache({ data: pageData, _k: pageArg })
              data[i] = pageData
            }
            if (parallel) {
              revalidators.push(revalidate)
            } else {
              await revalidate()
            }
          } else {
            data[i] = pageData
          }
          if (!parallel) {
            previousPageData = pageData
          }
        }

        // flush all revalidateions in parallel
        if (parallel) {
          await Promise.all(revalidators.map(r => r()))
        }

        // return the data
        return data
      },
      config
    )

    const mutate = useCallback(
      // eslint-disable-next-line func-names
      function <T = Data[]>(
        data?:
          | undefined
          | Data[]
          | Promise<Data[] | undefined>
          | MutatorCallback<Data[]>,
        opts?: undefined | boolean | SWRInfiniteMutatorOptions<Data[], T>
      ) {
        // When passing as a boolean, it's explicitly used to disable/enable
        // revalidation.
        const options =
          typeof opts === 'boolean' ? { revalidate: opts } : opts || {}

        // Default to true.
        const shouldRevalidate = options.revalidate !== false

        // It is possible that the key is still falsy.
        if (!infiniteKey) return EMPTY_PROMISE

        if (shouldRevalidate) {
          // We must write metadata to the cache BEFORE calling swr.mutate.
          // This allows SWR to merge our metadata with the new data, ensuring
          // flags like _r (revalidate) and size (instanceId) are preserved.
          setRef.current({
            _i: isUndefined(data),
            _r: options.revalidate,
            [instanceId]: resolvePageSize()
          } as any)
        }

        return arguments.length
          ? swr.mutate(data, { ...options, revalidate: shouldRevalidate })
          : swr.mutate()
      },
      // swr.mutate is always the same reference
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [infiniteKey, cache, resolvePageSize, instanceId]
    )
    // Extend the SWR API

    const setSize = useCallback(
      (arg: number | ((size: number) => number)) => {
        // It is possible that the key is still falsy.
        if (!infiniteKey) return EMPTY_PROMISE

        let size
        if (isFunction(arg)) {
          size = arg(resolvePageSize())
        } else if (typeof arg == 'number') {
          size = arg
        }
        if (typeof size != 'number') return EMPTY_PROMISE

        setRef.current({ [instanceId]: size } as any)
        lastPageSizeRef.current = size

        // Calculate the page data after the size change.
        const data: Data[] = []
        const [getInfiniteCache] = createCacheHelper<
          Data,
          SWRInfiniteCacheValue<Data[], any>
        >(cache, infiniteKey)
        let previousPageData = null
        for (let i = 0; i < size; ++i) {
          const [pageKey] = serialize(getKey(i, previousPageData))
          const [getCache] = createCacheHelper<
            Data,
            SWRInfiniteCacheValue<Data, any>
          >(cache, pageKey)
          // Get the cached page data.
          const pageData = pageKey ? getCache().data : UNDEFINED

          // Call `mutate` with infinte cache data if we can't get it from the page cache.
          if (isUndefined(pageData)) {
            return mutate(getInfiniteCache().data)
          }

          data.push(pageData)
          previousPageData = pageData
        }
        return mutate(data)
      },
      // exclude getKey from the dependencies, which isn't allowed to change during the lifecycle
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [infiniteKey, cache, mutate, resolvePageSize, instanceId]
    )

    // Use getter functions to avoid unnecessary re-renders caused by triggering
    // all the getters of the returned swr object.
    return {
      size: resolvePageSize(),
      setSize,
      mutate,
      get data() {
        const d = swr.data
        if (isExplicitSize && !isUndefined(d)) {
          const currentSize = resolvePageSize()
          if (d.length > currentSize) return d.slice(0, currentSize)
        }
        return d
      },
      get error() {
        return swr.error
      },
      get isValidating() {
        return swr.isValidating
      },
      get isLoading() {
        return swr.isLoading
      }
    }
  }) as unknown as Middleware

const useSWRInfinite = withMiddleware(useSWR, infinite) as SWRInfiniteHook

export default useSWRInfinite

export {
  SWRInfiniteConfiguration,
  SWRInfiniteResponse,
  SWRInfiniteHook,
  SWRInfiniteKeyLoader,
  SWRInfiniteFetcher,
  SWRInfiniteCompareFn,
  SWRInfiniteKeyedMutator,
  SWRInfiniteMutatorOptions
}
