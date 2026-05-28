import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

/**
 * Top-level error boundary so a runtime crash shows a readable message
 * instead of a blank white screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ info });
    // eslint-disable-next-line no-console
    console.error("[Cenote] unhandled error", error, info);
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="min-h-[100dvh] bg-[#f9fafb] flex items-center justify-center p-6">
        <div className="max-w-2xl w-full rounded-3xl border border-red-200 bg-white p-7 shadow-[0_30px_60px_-20px_rgba(0,0,0,0.12)]">
          <div className="inline-flex items-center gap-2 mb-3">
            <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
            <span className="text-[11px] uppercase tracking-[0.14em] font-semibold text-red-700">
              Cenote crashed
            </span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight mb-2">
            Something threw at render time
          </h1>
          <p className="text-[13px] text-neutral-600 mb-5 leading-relaxed">
            The UI caught the error below before it became a blank page. Copy the message and
            stack trace and share it back so it can be fixed.
          </p>

          <div className="rounded-xl border border-red-200 bg-red-50/60 p-3 mb-3">
            <div className="text-[10px] uppercase tracking-[0.14em] text-red-700 font-semibold mb-1">
              {error.name}
            </div>
            <p className="font-mono text-[12px] text-red-900 break-words whitespace-pre-wrap">
              {error.message}
            </p>
          </div>

          {error.stack && (
            <details className="rounded-xl border border-slate-200 bg-neutral-50 p-3">
              <summary className="cursor-pointer text-[11px] uppercase tracking-[0.14em] font-semibold text-neutral-600">
                Stack trace
              </summary>
              <pre className="mt-2 font-mono text-[10px] text-neutral-700 leading-relaxed overflow-x-auto whitespace-pre-wrap">
                {error.stack}
              </pre>
            </details>
          )}

          {info?.componentStack && (
            <details className="mt-2 rounded-xl border border-slate-200 bg-neutral-50 p-3">
              <summary className="cursor-pointer text-[11px] uppercase tracking-[0.14em] font-semibold text-neutral-600">
                Component stack
              </summary>
              <pre className="mt-2 font-mono text-[10px] text-neutral-700 leading-relaxed overflow-x-auto whitespace-pre-wrap">
                {info.componentStack}
              </pre>
            </details>
          )}

          <div className="mt-5 flex items-center gap-3">
            <button
              onClick={() => {
                this.setState({ error: null, info: null });
              }}
              className="rounded-full bg-neutral-900 text-white text-[12px] font-medium px-4 py-1.5 hover:bg-neutral-800 active:translate-y-[1px]"
            >
              Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              className="rounded-full bg-neutral-100 text-neutral-700 text-[12px] font-medium px-4 py-1.5 hover:bg-neutral-200 active:translate-y-[1px]"
            >
              Reload page
            </button>
          </div>
        </div>
      </div>
    );
  }
}
