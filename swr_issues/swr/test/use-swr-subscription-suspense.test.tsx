import React, { Suspense } from "react";
import { render, screen, act } from "@testing-library/react";
import useSWRSubscription from "../src/subscription/index";
import { SWRConfig } from "../src/index/index";


class ErrorBoundary extends React.Component<any, { hasError: boolean }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) return <div data-testid="error">Error Caught</div>;
    return this.props.children;
  }
}

describe("SWR Subscription Robustness", () => {

  it("should NOT leak subscriptions on unmount (Reference Counting Check)", async () => {
    const dispose = jest.fn();
    const subscribe = jest.fn((_key, { next }) => {
      setTimeout(() => next(null, "data"), 10);
      return dispose;
    });

    function Component() {
      useSWRSubscription("leak-test", subscribe as any, { suspense: true });
      return <div>loaded</div>;
    }

    const { unmount } = render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <Suspense fallback={<div>loading</div>}>
          <Component />
        </Suspense>
      </SWRConfig>
    );


    await screen.findByText("loaded");


    unmount();


    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("should handle Synchronous data without suspending", async () => {
    const subscribe = jest.fn((_key, { next }) => {

      next(null, "Sync Data");
      return () => { };
    });

    function Component() {
      const { data } = useSWRSubscription("sync-test", subscribe as any, { suspense: true });
      return <div data-testid="content">{data as string}</div>;
    }

    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <Suspense fallback={<div data-testid="loading">Loading...</div>}>
          <Component />
        </Suspense>
      </SWRConfig>
    );


    expect(screen.queryByTestId("loading")).toBeNull();
    expect(screen.getByTestId("content").textContent).toBe("Sync Data");
  });

  it("should bubble errors to ErrorBoundary", async () => {
    const subscribe = jest.fn((_key, { next }) => {
      setTimeout(() => next(new Error("Boom"), null), 10);
      return () => { };
    });

    function Component() {
      useSWRSubscription("error-test", subscribe as any, { suspense: true });
      return <div>Should not render</div>;
    }

    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <ErrorBoundary>
          <Suspense fallback={<div>loading</div>}>
            <Component />
          </Suspense>
        </ErrorBoundary>
      </SWRConfig>
    );

    expect(await screen.findByTestId("error")).toHaveTextContent("Error Caught");
  });

  it("should not crash if data arrives after unmount", async () => {
    let globalNext: any;
    const subscribe = jest.fn((_key, { next }) => {
      globalNext = next;

      next(null, "Initial");
      return () => { };
    });

    function Component() {
      useSWRSubscription("race-condition-test", subscribe as any, { suspense: true });
      return <div>loaded</div>;
    }

    const { unmount } = render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <Suspense fallback={<div>loading</div>}>
          <Component />
        </Suspense>
      </SWRConfig>
    );

    await screen.findByText("loaded");


    unmount();


    await act(async () => {
      globalNext(null, "Late Data");
    });


  });
});
