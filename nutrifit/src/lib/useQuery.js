// Tiny stale-while-revalidate cache. Keeps the last result per key in memory
// so revisiting a page shows data instantly instead of a spinner, while a
// fresh fetch runs in the background and updates it. Cache lives for the
// browser session (cleared on full reload).

import { useEffect, useRef, useState } from 'react'

const cache = new Map()

export function useQuery(key, fetcher, deps = []) {
  const hasCache = key != null && cache.has(key)
  const [data, setData] = useState(hasCache ? cache.get(key) : undefined)
  // Only show the loading state when we have nothing cached to render.
  const [loading, setLoading] = useState(!hasCache)
  const [error, setError] = useState(null)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  useEffect(() => {
    if (key == null) return
    let cancelled = false
    const cached = cache.has(key)
    setData(cached ? cache.get(key) : undefined)
    setLoading(!cached)
    ;(async () => {
      try {
        const result = await fetcherRef.current()
        if (cancelled) return
        cache.set(key, result)
        setData(result)
        setError(null)
      } catch (e) {
        if (!cancelled) setError(e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ...deps])

  const refresh = async () => {
    if (key == null) return
    const result = await fetcherRef.current()
    cache.set(key, result)
    setData(result)
    return result
  }

  return { data, loading, error, refresh, setData }
}

// Drop cached entries so the next visit refetches. Pass a prefix to clear a
// family of keys (e.g. after a mutation), or nothing to clear everything.
export function invalidateQuery(prefix) {
  if (prefix == null) { cache.clear(); return }
  for (const k of cache.keys()) if (k === prefix || k.startsWith(prefix + ':')) cache.delete(k)
}
