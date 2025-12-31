


repo link: https://github.com/vercel/swr

repo_issue: https://github.com/vercel/swr/issues/4158

base commit: 705104016a6fb1d3536c8b9278acf30ddda0f770



// --- SYNCHRONOUS FALLBACK CACHE MATERIALIZATION FIX ---
// Get the actual cache instance being used.
const cacheInstance = (cacheContext && cacheContext[0]) || (extendedConfig as any).cache || defaultCache
const fallbackData = extendedConfig?.fallback || {} 

// We should only write to the cache if:
// 1. We just created a NEW cache instance (cacheContext is present)
// 2. OR we are likely the ROOT config (parentConfig is empty), so we write to the global defaultCache.
// This prevents nested configs sharing a parent cache from "leaking" their fallback data upwards.
const shouldHydrate = !!cacheContext || Object.keys(parentConfig).length === 0;

if (shouldHydrate) {
    for (const key in fallbackData) {
        if (Object.prototype.hasOwnProperty.call(fallbackData, key)) {
            
            //  Only write if the key doesn't exist.
            if (!cacheInstance.get(key)) {
                const data = fallbackData[key]
                
                // Ensure we only hydrate plain data 
                if (typeof data !== 'function' && (typeof data !== 'object' || data === null)) {
                    
                    // Write the minimal necessary state for a resolved entry
                    cacheInstance.set(key, { 
                        data: data, 
                        error: UNDEFINED, 
                        _k: key,
                        _fn: null
                    } as any);
                }
            }
        }
    }
}
// --- END SYNCHRONOUS FALLBACK CACHE MATERIALIZATION FIX ---