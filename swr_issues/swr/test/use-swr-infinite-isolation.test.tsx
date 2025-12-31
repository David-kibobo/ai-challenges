import { render, waitFor, cleanup, act } from '@testing-library/react';
import useSWRInfinite from 'swr/infinite';
import { SWRConfig } from 'swr';
import { useState, useEffect } from 'react';

afterEach(cleanup);

const fetcher = (key: string) => 
  new Promise(res => setTimeout(() => res(`data-${key}-${Math.random()}`), 50));

const getKey = (pageIndex: number) => `shared-infinite-key?page=${pageIndex}`;

function Page({ id, initialSize }: { id: string, initialSize: number }) {
  const { data, size, setSize } = useSWRInfinite(getKey, fetcher, { 
    initialSize,
    revalidateFirstPage: false,
    dedupingInterval: 0
  });

  useEffect(() => {
    (window as any)[`setSize${id}`] = setSize;
  }, [setSize, id]);

  return (
    <div>
      <div data-testid={`data-count-${id}`}>{data?.length ?? 0}</div>
      <div data-testid={`hook-size-${id}`}>{size}</div>
    </div>
  );
}

describe('useSWRInfinite Isolation', () => {
  
  test('initialSize configuration of independent instances', async () => {
    const cache = new Map();

    function MountTestWrapper() {
      const [showB, setShowB] = useState(false);
      useEffect(() => {
        const timer = setTimeout(() => setShowB(true), 200);
        return () => clearTimeout(timer);
      }, []);

      return (
        <>
          <Page id="A" initialSize={1} />
          {showB && <Page id="B" initialSize={3} />}
        </>
      );
    }

    const { getByTestId } = render(
      <SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}>
        <MountTestWrapper />
      </SWRConfig>
    );

    await waitFor(() => expect(getByTestId('data-count-A').textContent).toBe('1'));
    await waitFor(() => expect(getByTestId('data-count-B').textContent).toBe('3'), { timeout: 3000 });

    const finalDataA = getByTestId('data-count-A').textContent;
    expect(finalDataA).toBe('1');
  });

  test('setSize state isolation between independent instances', async () => {
    const cache = new Map();

    const { getByTestId } = render(
      <SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}>
        <Page id="A" initialSize={1} />
        <Page id="B" initialSize={1} />
      </SWRConfig>
    );

    await waitFor(() => {
      expect(getByTestId('hook-size-A').textContent).toBe('1');
      expect(getByTestId('hook-size-B').textContent).toBe('1');
    });

    await act(async () => {
      await (window as any).setSizeB(3);
    });

    await waitFor(() => expect(getByTestId('hook-size-B').textContent).toBe('3'));

    const finalSizeA = getByTestId('hook-size-A').textContent;
    expect(finalSizeA).toBe('1');
  });
});

