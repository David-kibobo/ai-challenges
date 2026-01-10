import type {
  Key,
  SWRHook,
  Middleware,
  SWRConfiguration,
  SWRConfig
} from '../index'
import type {
  SWRSubscriptionOptions,
  SWRSubscription,
  SWRSubscriptionResponse,
  SWRSubscriptionHook
} from './types'
import useSWR from '../index'
import {
  withMiddleware,
  serialize,
  useIsomorphicLayoutEffect,
  createCacheHelper
} from '../_internal'

// [subscription count, disposer, promise]
type SubscriptionStates = [
  Map<string, number>,
  Map<string, () => void>,
  Map<string, { p: Promise<any>; r: (v: any) => void }>
]
const subscriptionStorage = new WeakMap<object, SubscriptionStates>()

const SUBSCRIPTION_PREFIX = '$sub$'

export const subscription = (<Data = any, Error = any>(useSWRNext: SWRHook) =>
  (
    _key: Key,
    subscribe: SWRSubscription<any, Data, Error>,
    config: SWRConfiguration & typeof SWRConfig.defaultValue
  ): SWRSubscriptionResponse<Data, Error> => {
    const [key, args] = serialize(_key)

    // Prefix the key to avoid conflicts with other SWR resources.
    const subscriptionKey = key ? SUBSCRIPTION_PREFIX + key : undefined

    // Disable internal suspense to prevent deadlock; we handle it manually.
    const swr = useSWRNext(
      subscriptionKey,
      null,
      config.suspense ? { ...config, suspense: false } : config
    )

    const { cache } = config

    // Ensure that the subscription state is scoped by the cache boundary, so
    // you can have multiple SWR zones with subscriptions having the same key.
    if (!subscriptionStorage.has(cache)) {
      subscriptionStorage.set(cache, [
        new Map<string, number>(),
        new Map<string, () => void>(),
        new Map<string, { p: Promise<any>; r: (v: any) => void }>()
      ])
    }

    const [subscriptions, disposers, promises] = subscriptionStorage.get(cache)!

    const startSubscription = () => {
      if (!subscriptionKey) return
      const [, set] = createCacheHelper<Data>(cache, subscriptionKey)

      const next: SWRSubscriptionOptions<Data, Error>['next'] = (
        error,
        data
      ) => {
        if (error !== null && typeof error !== 'undefined') {
          set({ error })

          // Resolve suspense promise if pending
          const pending = promises.get(subscriptionKey)
          if (pending) {
            pending.r(error)
            promises.delete(subscriptionKey)
          }

          // Safe mutate: ignore race condition on unmount
          try {
            swr
              .mutate(
                () => {
                  throw error
                },
                { revalidate: false }
              )
              .catch(() => {
                // Ignore async errors when component is unmounted
              })
          } catch {
            // Ignore sync errors when component is unmounted
          }
        } else {
          set({ error: undefined })

          // Resolve suspense promise if pending
          const pending = promises.get(subscriptionKey)
          if (pending) {
            pending.r(data)
            promises.delete(subscriptionKey)
          }

          // Safe mutate: ignore race condition on unmount
          try {
            swr.mutate(data, false).catch(() => {
              // Ignore async errors when component is unmounted
            })
          } catch {
            // Ignore sync errors when component is unmounted
          }
        }
      }

      // Check if already subscribed to deduplicate.
      if (!disposers.has(subscriptionKey)) {
        const dispose = subscribe(args, { next })
        if (typeof dispose !== 'function') {
          throw new Error(
            'The `subscribe` function must return a function to unsubscribe.'
          )
        }
        disposers.set(subscriptionKey, dispose)
      }
    }

    // Manual Suspense Logic
    if (config.suspense && subscriptionKey) {
      const cached = cache.get(subscriptionKey)
      if (cached?.error) throw cached.error

      if (cached?.data === undefined && swr.data === undefined) {
        startSubscription()
        const postCached = cache.get(subscriptionKey)

        if (postCached?.error) throw postCached.error
        if (postCached?.data === undefined) {
          let pending = promises.get(subscriptionKey)
          if (!pending) {
            let resolve: any
            const p = new Promise(r => (resolve = r))
            pending = { p, r: resolve }
            promises.set(subscriptionKey, pending)
          }
          throw pending.p
        }
      }
    }

    useIsomorphicLayoutEffect(() => {
      if (!subscriptionKey) return

      const refCount = subscriptions.get(subscriptionKey) || 0

      // Increment the ref count.
      subscriptions.set(subscriptionKey, refCount + 1)

      try {
        startSubscription()
      } catch (error) {
        // Reset ref count and throw so the Error Boundary catches it.
        subscriptions.set(subscriptionKey, refCount)
        throw error
      }

      return () => {
        const count = subscriptions.get(subscriptionKey)! - 1

        subscriptions.set(subscriptionKey, count)

        // Dispose if it's the last one.
        if (!count) {
          const dispose = disposers.get(subscriptionKey)
          dispose?.()
          disposers.delete(subscriptionKey)
          promises.delete(subscriptionKey)
        }
      }
    }, [subscriptionKey])

    return {
      get data() {
        return swr.data
      },
      get error() {
        return swr.error
      }
    }
  }) as unknown as Middleware

/**
 * A hook to subscribe a SWR resource to an external data source for continuous updates.
 * @experimental This API is experimental and might change in the future.
 * @example
 * ```jsx
 * import useSWRSubscription from 'swr/subscription'
 *
 * const { data, error } = useSWRSubscription(key, (key, { next }) => {
 * const unsubscribe = dataSource.subscribe(key, (err, data) => {
 * next(err, data)
 * })
 * return unsubscribe
 * })
 * ```
 */
const useSWRSubscription = withMiddleware(
  useSWR,
  subscription
) as SWRSubscriptionHook

export default useSWRSubscription

export type {
  SWRSubscription,
  SWRSubscriptionOptions,
  SWRSubscriptionResponse,
  SWRSubscriptionHook
}
