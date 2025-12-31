import { serialize } from './serialize'
import { createCacheHelper } from './helper'
import {
  isFunction,
  isUndefined,
  UNDEFINED,
  mergeObjects,
  isPromiseLike
} from './shared'
import { SWRGlobalState } from './global-state'
import { getTimestamp } from './timestamp'
import * as revalidateEvents from '../events'
import type {
  Cache,
  MutatorCallback,
  MutatorOptions,
  GlobalState,
  State,
  Arguments,
  Key
} from '../types'

type KeyFilter = (key?: Arguments) => boolean
type MutateState<Data> = State<Data, any> & {
  // The previously committed data.
  _c?: Data
}

export async function internalMutate<Data>(
  cache: Cache,
  _key: KeyFilter,
  _data?: Data | Promise<Data | undefined> | MutatorCallback<Data>,
  _opts?: boolean | MutatorOptions<Data>
): Promise<Array<Data | undefined>>
export async function internalMutate<Data>(
  cache: Cache,
  _key: Arguments,
  _data?: Data | Promise<Data | undefined> | MutatorCallback<Data>,
  _opts?: boolean | MutatorOptions<Data>
): Promise<Data | undefined>
export async function internalMutate<Data>(
  ...args: [
    cache: Cache,
    _key: KeyFilter | Arguments,
    _data?: Data | Promise<Data | undefined> | MutatorCallback<Data>,
    _opts?: boolean | MutatorOptions<Data>
  ]
): Promise<any> {
  const [cache, _key, _data, _opts] = args

  // When passing as a boolean, it's explicitly used to disable/enable
  // revalidation.
  const options = mergeObjects(
    { populateCache: true, throwOnError: true },
    typeof _opts === 'boolean' ? { revalidate: _opts } : _opts || {}
  )

  let populateCache = options.populateCache

  const rollbackOnErrorOption = options.rollbackOnError
  let optimisticData = options.optimisticData

  const rollbackOnError = (error: unknown): boolean => {
    return typeof rollbackOnErrorOption === 'function'
      ? rollbackOnErrorOption(error)
      : rollbackOnErrorOption !== false
  }
  const throwOnError = options.throwOnError

  // If the second argument is a key filter, return the mutation results for all
  // filtered keys.
  if (isFunction(_key)) {
    const keyFilter = _key
    const matchedKeys: Key[] = []
    const it = cache.keys()
    for (const key of it) {
      if (
        // Skip the special useSWRInfinite and useSWRSubscription keys.
        !/^\$(inf|sub)\$/.test(key) &&
        keyFilter((cache.get(key) as { _k: Arguments })._k)
      ) {
        matchedKeys.push(key)
      }
    }
    return Promise.all(matchedKeys.map(mutateByKey))
  }

  return mutateByKey(_key)

  async function mutateByKey(_k: Key): Promise<Data | undefined> {
    // Serialize key
    const [key] = serialize(_k)
    if (!key) return
    const [get, set] = createCacheHelper<Data, MutateState<Data>>(cache, key)
    const [EVENT_REVALIDATORS, MUTATION, FETCH, PRELOAD] = SWRGlobalState.get(
      cache
    ) as GlobalState

    const startRevalidate = () => {
      const revalidators = EVENT_REVALIDATORS[key]
      const revalidate = isFunction(options.revalidate)
        ? options.revalidate(get().data, _k)
        : options.revalidate !== false
      if (revalidate) {
        // Invalidate the key by deleting the concurrent request markers so new
        // requests will not be deduped.
        delete FETCH[key]
        delete PRELOAD[key]
        if (revalidators && revalidators[0]) {
          return revalidators[0](revalidateEvents.MUTATE_EVENT).then(
            () => get().data
          )
        }
      }
      return get().data
    }

    // If there is no new data provided, revalidate the key with current state.
    if (args.length < 3) {
      // Revalidate and broadcast state.
      return startRevalidate()
    }

    let data: any = _data
    let error: unknown
    let isError = false

    // Update global timestamps.
    const beforeMutationTs = getTimestamp()
    MUTATION[key] = [beforeMutationTs, 0]

    const hasOptimisticData = !isUndefined(optimisticData)
    const state = get()

    // `displayedData` is the current value on screen. It could be the optimistic value
    // that is going to be overridden by a `committedData`, or get reverted back.
    // `committedData` is the validated value that comes from a fetch or mutation.
    const displayedData = state.data
    const currentData = state._c
    const committedData = isUndefined(currentData) ? displayedData : currentData

    // Do optimistic data update.
    if (hasOptimisticData) {
      optimisticData = isFunction(optimisticData)
        ? optimisticData(committedData, displayedData)
        : optimisticData

      // When we set optimistic data, backup the current committedData data in `_c`.
      set({ data: optimisticData, _c: committedData })
    }

    if (isFunction(data)) {
      // `data` is a function, call it passing current cache value.
      try {
        data = (data as MutatorCallback<Data>)(committedData)
      } catch (err) {
        // If it throws an error synchronously, we shouldn't update the cache.
        error = err
        isError = true
      }
    }

    // `data` is a promise/thenable, resolve the final data first.
    if (data && isPromiseLike(data)) {
      // This means that the mutation is async, we need to check timestamps to
      // avoid race conditions.
      data = await (data as Promise<Data>).catch(err => {
        error = err
        isError = true
      })

      // Check if other mutations have occurred since we've started this mutation.
      // If there's a race we don't update cache or broadcast the change,
      // just return the data.
      if (beforeMutationTs !== MUTATION[key][0]) {
        if (isError) throw error
        return data
      } else if (isError && hasOptimisticData && rollbackOnError(error)) {
        // Rollback. Always populate the cache in this case but without
        // transforming the data.
        populateCache = true

        // Reset data to be the latest committed data, and clear the `_c` value.
        set({ data: committedData, _c: UNDEFINED })
      }
    }

    // If we should write back the cache after request.
    if (populateCache) {
      if (!isError) {
        // Transform the result into data.
        if (isFunction(populateCache)) {
          const populateCachedData = populateCache(data, committedData)
          set({ data: populateCachedData, error: UNDEFINED, _c: UNDEFINED })
        } else {
          // Only update cached data and reset the error if there's no error. Data can be `undefined` here.
          set({ data, error: UNDEFINED, _c: UNDEFINED })
        }
      }
    }

    // Reset the timestamp to mark the mutation has ended.
    MUTATION[key][1] = getTimestamp()

    // Update existing SWR Hooks' internal states:
    Promise.resolve(startRevalidate()).then(() => {
      // The mutation and revalidation are ended, we can clear it since the data is
      // not an optimistic value anymore.
      set({ _c: UNDEFINED })
    })

    // Throw error or return data
    if (isError) {
      if (throwOnError) throw error
      return
    }
    return data
  }
}
// import { serialize } from './serialize'
// import { createCacheHelper } from './helper'
// import {
//   isFunction,
//   isUndefined,
//   UNDEFINED,
//   mergeObjects,
//   isPromiseLike
// } from './shared'
// import { SWRGlobalState } from './global-state'
// import { getTimestamp } from './timestamp'
// import * as revalidateEvents from '../events'
// import type {
//   Cache,
//   MutatorCallback,
//   MutatorOptions,
//   GlobalState,
//   State,
//   Arguments,
//   Key
// } from '../types'

// type KeyFilter = (key?: Arguments) => boolean
// type MutateState<Data> = State<Data, any> & {
//   _c?: Data
// }

// export async function internalMutate<Data>(
//   cache: Cache,
//   _key: KeyFilter,
//   _data?: Data | Promise<Data | undefined> | MutatorCallback<Data>,
//   _opts?: boolean | MutatorOptions<Data>
// ): Promise<Array<Data | undefined>>
// export async function internalMutate<Data>(
//   cache: Cache,
//   _key: Arguments,
//   _data?: Data | Promise<Data | undefined> | MutatorCallback<Data>,
//   _opts?: boolean | MutatorOptions<Data>
// ): Promise<Data | undefined>
// export async function internalMutate<Data>(
//   ...args: [
//     cache: Cache,
//     _key: KeyFilter | Arguments,
//     _data?: Data | Promise<Data | undefined> | MutatorCallback<Data>,
//     _opts?: boolean | MutatorOptions<Data>
//   ]
// ): Promise<any> {
//   const [cache, _key, _data, _opts] = args

//   // Merge options with default values.
//   const options = mergeObjects(
//     { populateCache: true, throwOnError: true },
//     typeof _opts === 'boolean' ? { revalidate: _opts } : _opts || {}
//   )

//   let populateCache = options.populateCache
//   const rollbackOnErrorOption = options.rollbackOnError
//   let optimisticData = options.optimisticData

//   const rollbackOnError = (error: unknown): boolean => {
//     return typeof rollbackOnErrorOption === 'function'
//       ? rollbackOnErrorOption(error)
//       : rollbackOnErrorOption !== false
//   }
//   const throwOnError = options.throwOnError

//   // If the key is a function, it's a filter. Mutate all matched keys.
//   if (isFunction(_key)) {
//     const keyFilter = _key
//     const matchedKeys: Key[] = []
//     const it = cache.keys()
//     for (const key of it) {
//       if (
//         !/^\$(inf|sub)\$/.test(key) &&
//         keyFilter((cache.get(key) as { _k: Arguments })._k)
//       ) {
//         matchedKeys.push(key)
//       }
//     }
//     return Promise.all(matchedKeys.map(mutateByKey))
//   }

//   return mutateByKey(_key)

//   async function mutateByKey(_k: Key): Promise<Data | undefined> {
//     const [key] = serialize(_k)
//     if (!key) return
//     const [get, set] = createCacheHelper<Data, MutateState<Data>>(cache, key)
//     const [EVENT_REVALIDATORS, MUTATION, FETCH, PRELOAD] = SWRGlobalState.get(
//       cache
//     ) as GlobalState

//     const startRevalidate = () => {
//       const revalidators = EVENT_REVALIDATORS[key]
//       const revalidate = isFunction(options.revalidate)
//         ? options.revalidate(get().data, _k)
//         : options.revalidate !== false
//       if (revalidate) {
//         // Reset the loading state of the fetcher and preload.
//         delete FETCH[key]
//         delete PRELOAD[key]
//         if (revalidators && revalidators[0]) {
//           return revalidators[0](revalidateEvents.MUTATE_EVENT).then(
//             () => get().data
//           )
//         }
//       }
//       return get().data
//     }

//     // If no data is provided, just revalidate.
//     if (args.length < 3) {
//       return startRevalidate()
//     }

//     let data: any = _data
//     let error: unknown
//     let isError = false

//     const beforeMutationTs = getTimestamp()
//     MUTATION[key] = [beforeMutationTs, 0]

//     const hasOptimisticData = !isUndefined(optimisticData)
//     const state = get()

//     // displayedData: The current value in the cache (could be optimistic from a previous mutation).
//     // originalData: The last confirmed server state.
//     const displayedData = state.data
//     const originalData = isUndefined(state._c) ? displayedData : state._c

//     // 1. Apply Optimistic Update
//     if (hasOptimisticData) {
//       optimisticData = isFunction(optimisticData)
//         ? optimisticData(displayedData, originalData)
//         : optimisticData

//       // Set the new optimistic data, but preserve the first 'originalData' in the chain.
//       set({
//         data: optimisticData,
//         _c: originalData
//       })
//     }

//     // 2. Execute the Mutator
//     if (isFunction(data)) {
//       try {
//         // Use displayedData to allow chaining (e.g., prev => prev + 1)
//         data = (data as MutatorCallback<Data>)(displayedData)
//       } catch (err) {
//         error = err
//         isError = true
//       }
//     }

//     // 3. Resolve Promise and handle Errors/Rollbacks
//     if (data && isPromiseLike(data)) {
//       data = await (data as Promise<Data>).catch(err => {
//         error = err
//         isError = true
//       })

//       // Race condition check.
//       if (beforeMutationTs !== MUTATION[key][0]) {
//         if (isError) throw error
//         return data
//       } else if (isError && hasOptimisticData && rollbackOnError(error)) {
//         // Rollback to the preserved server truth.
//         set({ data: originalData, _c: UNDEFINED })
//         populateCache = false
//       }
//     }

//     // 4. Update Cache with Final Result
//     if (populateCache && !isError) {
//       if (isFunction(populateCache)) {
//         // Pass originalData (the stable base) to the transformation callback.
//         set({
//           data: populateCache(data, originalData),
//           error: UNDEFINED,
//           _c: UNDEFINED
//         })
//       } else {
//         set({ data, error: UNDEFINED, _c: UNDEFINED })
//       }
//     }

//     MUTATION[key][1] = getTimestamp()

//     // 5. Revalidate and Final Cleanup
//     Promise.resolve(startRevalidate()).then(() => {
//       // Only clear the backup if this mutation is still the most recent one.
//       if (beforeMutationTs === MUTATION[key][0]) {
//         set({ _c: UNDEFINED })
//       }
//     })

//     if (isError) {
//       if (throwOnError) throw error
//       return
//     }
//     return data
//   }
// }
