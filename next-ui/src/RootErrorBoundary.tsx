import { Component, type CSSProperties, type ErrorInfo, type ReactNode } from "react";

interface RootErrorBoundaryProps {
  readonly children: ReactNode;
}

interface RootErrorBoundaryState {
  readonly error: Error | null;
  readonly errorInfo: ErrorInfo | null;
  readonly source: "react" | "window" | "promise" | null;
}

function errorFromUnknown(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return new Error(value);
  }
  try {
    return new Error(JSON.stringify(value));
  } catch {
    return new Error(String(value));
  }
}

function errorDetails(error: Error, info: ErrorInfo | null): string {
  return [error.stack || `${error.name}: ${error.message}`, info?.componentStack].filter(Boolean).join("\n\nComponent stack:\n");
}

const BENIGN_RESIZE_OBSERVER_ERROR_MESSAGES = new Set(["ResizeObserver loop completed with undelivered notifications.", "ResizeObserver loop limit exceeded"]);

function errorMessage(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }
  return typeof value === "string" ? value : "";
}

function isBenignResizeObserverError(value: unknown): boolean {
  return BENIGN_RESIZE_OBSERVER_ERROR_MESSAGES.has(errorMessage(value));
}

const pageStyle: CSSProperties = {
  minHeight: "100dvh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  background: "#0d1117",
  color: "#e6edf3",
  fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
};

const panelStyle: CSSProperties = {
  width: "min(760px, 100%)",
  border: "1px solid #30363d",
  borderRadius: 8,
  background: "#161b22",
  padding: 16,
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: 18,
  lineHeight: 1.35,
  fontWeight: 700,
};

const textStyle: CSSProperties = {
  margin: "8px 0 0",
  color: "#8b949e",
  fontSize: 14,
  lineHeight: 1.5,
};

const actionRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  marginTop: 14,
};

const primaryButtonStyle: CSSProperties = {
  border: 0,
  borderRadius: 6,
  padding: "8px 12px",
  background: "#0084ff",
  color: "#ffffff",
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
};

const secondaryButtonStyle: CSSProperties = {
  border: "1px solid #444c56",
  borderRadius: 6,
  padding: "8px 12px",
  background: "#21262d",
  color: "#e6edf3",
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
};

const detailsStyle: CSSProperties = {
  margin: "14px 0 0",
};

const summaryStyle: CSSProperties = {
  cursor: "pointer",
  color: "#8b949e",
  fontSize: 13,
};

const preStyle: CSSProperties = {
  maxHeight: "45dvh",
  overflow: "auto",
  margin: "8px 0 0",
  padding: 12,
  borderRadius: 6,
  background: "#0d1117",
  color: "#e6edf3",
  fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Consolas, monospace',
  fontSize: 12,
  lineHeight: 1.45,
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
};

export class RootErrorBoundary extends Component<RootErrorBoundaryProps, RootErrorBoundaryState> {
  state: RootErrorBoundaryState = { error: null, errorInfo: null, source: null };

  static getDerivedStateFromError(error: unknown): RootErrorBoundaryState {
    return { error: errorFromUnknown(error), errorInfo: null, source: "react" };
  }

  componentDidMount(): void {
    window.addEventListener("error", this.handleWindowError);
    window.addEventListener("unhandledrejection", this.handleUnhandledRejection);
  }

  componentWillUnmount(): void {
    window.removeEventListener("error", this.handleWindowError);
    window.removeEventListener("unhandledrejection", this.handleUnhandledRejection);
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("[rlab] Uncaught React render error", error, errorInfo.componentStack);
    this.setState({ error, errorInfo, source: "react" });
  }

  private readonly handleWindowError = (event: ErrorEvent): void => {
    if (isBenignResizeObserverError(event.error) || isBenignResizeObserverError(event.message)) {
      event.preventDefault();
      return;
    }
    const error = event.error ? errorFromUnknown(event.error) : new Error(event.message || "Unhandled window error");
    console.error("[rlab] Uncaught window error", error);
    this.setState({ error, errorInfo: null, source: "window" });
  };

  private readonly handleUnhandledRejection = (event: PromiseRejectionEvent): void => {
    const error = errorFromUnknown(event.reason);
    console.error("[rlab] Unhandled promise rejection", error);
    this.setState({ error, errorInfo: null, source: "promise" });
  };

  private readonly retryRender = (): void => {
    this.setState({ error: null, errorInfo: null, source: null });
  };

  private readonly reloadPage = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    const { error, errorInfo, source } = this.state;
    if (!error) {
      return this.props.children;
    }
    const sourceLabel = source === "promise" ? "unhandled promise rejection" : source === "window" ? "window error" : "React render error";
    return (
      <main role="alert" data-testid="root-error-boundary" style={pageStyle}>
        <section style={panelStyle}>
          <h1 style={titleStyle}>rlab client crashed</h1>
          <p style={textStyle}>
            Uncaught {sourceLabel}: {error.message || error.name}
          </p>
          <div style={actionRowStyle}>
            <button type="button" style={primaryButtonStyle} onClick={this.reloadPage}>
              Reload
            </button>
            <button type="button" style={secondaryButtonStyle} onClick={this.retryRender}>
              Retry render
            </button>
          </div>
          <details style={detailsStyle} open>
            <summary style={summaryStyle}>Error details</summary>
            <pre style={preStyle}>{errorDetails(error, errorInfo)}</pre>
          </details>
        </section>
      </main>
    );
  }
}
