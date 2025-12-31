import { render, screen, fireEvent, act } from '@testing-library/react'
import useSWRMutation from '../src/mutation/index'
import { SWRConfig } from '../src/index'
import { sleep } from './utils'

describe('useSWRMutation - Optimistic Data State', () => {
  it('should update "data" optimistically immediately', async () => {
    const fetcher = async () => {
      await sleep(100)
      return 'server'
    }
    function Page() {
      const { trigger, data } = useSWRMutation('key-1', fetcher, {
        optimisticData: 'optimistic'
      })
      return (
        <button data-testid="btn" onClick={() => trigger()}>
          {data || 'undefined'}
        </button>
      )
    }
    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <Page />
      </SWRConfig>
    )
    const btn = screen.getByTestId('btn')
    expect(btn.textContent).toBe('undefined')
    fireEvent.click(btn)
    expect(btn.textContent).toBe('optimistic')
    await act(() => sleep(150))
    expect(btn.textContent).toBe('server')
  })

  it('should prioritize optimisticData passed to trigger over hook config', async () => {
    const fetcher = async () => {
      await sleep(100)
      return 'server'
    }
    function Page() {
      const { trigger, data } = useSWRMutation('key-2', fetcher, {
        optimisticData: 'hook-level'
      })
      return (
        <button
          data-testid="btn"
          onClick={() =>
            trigger(undefined, { optimisticData: 'trigger-level' })
          }
        >
          {data || 'undefined'}
        </button>
      )
    }
    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <Page />
      </SWRConfig>
    )
    const btn = screen.getByTestId('btn')
    fireEvent.click(btn)
    expect(btn.textContent).toBe('trigger-level')
  })

  it('should rollback "data" to the previous value on failure', async () => {
    const fetcher = async () => {
      await sleep(50)
      throw new Error('fetch-failed')
    }

    function Page() {
      const { trigger, data, error } = useSWRMutation('key-3', fetcher, {
        optimisticData: 'optimistic-val',
        throwOnError: false,
        rollbackOnError: true
      })
      return (
        <div data-testid="container">
          <button onClick={() => trigger()}>trigger</button>
          <span data-testid="data">{data || 'undefined'}</span>
          <span data-testid="error">{error ? 'error' : 'no-error'}</span>
        </div>
      )
    }

    render(
      <SWRConfig
        value={{ fallback: { 'key-3': 'initial' }, provider: () => new Map() }}
      >
        <Page />
      </SWRConfig>
    )

    const triggerBtn = screen.getByText('trigger')
    const dataSpan = screen.getByTestId('data')

    expect(dataSpan.textContent).toBe('initial')

    fireEvent.click(triggerBtn)
    expect(dataSpan.textContent).toBe('optimistic-val')

    await act(() => sleep(100))
    expect(screen.getByTestId('error').textContent).toBe('error')
    expect(dataSpan.textContent).toBe('initial')
  })

  it('should respect trigger-level rollbackOnError and throwOnError options', async () => {
    const fetcher = async () => {
      await sleep(50)
      throw new Error('fetch-failed')
    }

    let triggerPromise: Promise<any> | undefined

    function Page() {
      const { trigger, data, error } = useSWRMutation('key-4', fetcher, {
        optimisticData: 'hook-optimistic',
        rollbackOnError: true,
        throwOnError: true
      })
      return (
        <div data-testid="container">
          <button
            onClick={() => {
              triggerPromise = trigger(undefined, {
                rollbackOnError: false,
                throwOnError: false
              })
            }}
          >
            trigger
          </button>
          <span data-testid="data">{data || 'undefined'}</span>
          <span data-testid="error">{error ? 'error' : 'no-error'}</span>
        </div>
      )
    }

    render(
      <SWRConfig
        value={{ fallback: { 'key-4': 'initial' }, provider: () => new Map() }}
      >
        <Page />
      </SWRConfig>
    )

    const triggerBtn = screen.getByText('trigger')
    const dataSpan = screen.getByTestId('data')

    expect(dataSpan.textContent).toBe('initial')

    fireEvent.click(triggerBtn)
    expect(dataSpan.textContent).toBe('hook-optimistic')

    await act(() => sleep(100))

    await expect(triggerPromise).resolves.toBeUndefined()

    expect(screen.getByTestId('error').textContent).toBe('error')

    expect(dataSpan.textContent).toBe('hook-optimistic')
  })
})
