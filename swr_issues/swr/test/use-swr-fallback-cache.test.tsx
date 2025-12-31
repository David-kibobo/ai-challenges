/**
 * @jest-environment jsdom
 */

import { render, screen } from '@testing-library/react'
import { act } from '@testing-library/react'
import useSWR from 'swr'
import useSWRImmutable from 'swr/immutable'
import { SWRConfig, useSWRConfig } from 'swr'
import React from 'react'

const nextTick = async () => Promise.resolve()

describe('SWR Fallback Cache Materialization', () => {
  interface CacheGrabberProps {
    children: React.ReactNode
    cacheRef: { current: any }
  }

  const CacheGrabber: React.FC<CacheGrabberProps> = ({
    children,
    cacheRef
  }) => {
    const config = useSWRConfig()

    cacheRef.current = config.cache
    return <>{children}</>
  }

  it('should materialize fallback data into cache and allow cache retrieval (useSWRImmutable)', async () => {
    const key = '/immutable-key'
    const fallbackData = 'bar'
    const cacheRef = { current: null }

    function ImmutableConsumer() {
      useSWRImmutable(key, null)
      return <div data-testid="ready">Ready</div>
    }

    render(
      <SWRConfig value={{ fallback: { [key]: fallbackData } }}>
        <CacheGrabber cacheRef={cacheRef}>
          <ImmutableConsumer />
        </CacheGrabber>
      </SWRConfig>
    )

    await act(async () => {
      await nextTick()
    })

    const cacheEntry = cacheRef.current?.get(key)

    expect(cacheEntry).not.toBeUndefined()
    expect(cacheEntry).not.toBeNull()

    expect((cacheEntry as any).data).toBe(fallbackData)
  })

  it('should materialize fallback data when revalidation is disabled (useSWR)', async () => {
    const key = '/standard-key'
    const fallbackData = 'baz'
    const cacheRef = { current: null }

    function StandardConsumer() {
      useSWR(key, null, { revalidateOnMount: false })
      return <div data-testid="ready">Ready</div>
    }

    render(
      <SWRConfig value={{ fallback: { [key]: fallbackData } }}>
        <CacheGrabber cacheRef={cacheRef}>
          <StandardConsumer />
        </CacheGrabber>
      </SWRConfig>
    )

    await act(async () => {
      await nextTick()
    })

    const cacheEntry = cacheRef.current?.get(key)

    expect(cacheEntry).not.toBeUndefined()
    expect(cacheEntry).not.toBeNull()

    expect((cacheEntry as any).data).toBe(fallbackData)
  })

  it('should allow synchronous cache access immediately after config mount', () => {
    const key = '/sync-access-key'
    const fallbackData = 'sync-data'
    const cacheRef = { current: null }

    render(
      <SWRConfig value={{ fallback: { [key]: fallbackData } }}>
        <CacheGrabber cacheRef={cacheRef}>
          {/* A child that does NOT use the key, proving the materialization is independent */}
          <div data-testid="placeholder" />
        </CacheGrabber>
      </SWRConfig>
    )

    const cacheEntry = cacheRef.current?.get(key)

    //The cache must contain the data immediately.
    expect(cacheEntry).not.toBeUndefined()
    expect(cacheEntry).not.toBeNull()
    expect((cacheEntry as any).data).toBe(fallbackData)
  })

  it('should populate cache for unconsumed key when a separate hook is used', async () => {
    const consumedKey = '/consumed-key'
    const unconsumedKey = '/unconsumed-key'
    const unconsumedData = 'unconsumed-data'
    const cacheRef = { current: null }

    function Consumer() {
      // Consume a different key
      const { data } = useSWR(consumedKey, null)
      return <div data-testid="data">{data}</div>
    }

    render(
      <SWRConfig value={{ fallback: { [unconsumedKey]: unconsumedData } }}>
        <CacheGrabber cacheRef={cacheRef}>
          <Consumer />
        </CacheGrabber>
      </SWRConfig>
    )

    await act(async () => {
      await nextTick()
    })

    const unconsumedEntry = cacheRef.current?.get(unconsumedKey)

    expect(unconsumedEntry).not.toBeUndefined()
    expect(unconsumedEntry).not.toBeNull()
    expect((unconsumedEntry as any).data).toBe(unconsumedData)
  })

  // test for falsy fallback values (null, 0, '', false)
  describe('should correctly materialize falsy fallback values', () => {
    const testFalsyValue = (name: string, value: any) => {
      it(`should handle falsy value: ${name}`, async () => {
        const key = `/falsy-key-${name}`
        const cacheRef = { current: null }

        function FalsyConsumer() {
          const { data } = useSWR(key, null)
          return <div data-testid="result">{String(data)}</div>
        }

        render(
          <SWRConfig value={{ fallback: { [key]: value } }}>
            <CacheGrabber cacheRef={cacheRef}>
              <FalsyConsumer />
            </CacheGrabber>
          </SWRConfig>
        )

        await act(async () => {
          await nextTick()
        })

        const cacheEntry = cacheRef.current?.get(key)
        expect(cacheEntry).not.toBeUndefined()

        expect((cacheEntry as any).data).toBe(value)

        expect(screen.getByTestId('result').textContent).toBe(String(value))
      })
    }

    testFalsyValue('null', null)
    testFalsyValue('0 (number)', 0)
    testFalsyValue('empty string', '')
    testFalsyValue('false', false)
  })
})
