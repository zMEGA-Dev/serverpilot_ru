import React from "react";

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary] Caught error:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100vh",
            gap: 12,
            color: "var(--text-primary)",
            fontFamily: "var(--font-sans)",
            background: "var(--bg-primary)",
          }}
        >
          <span style={{ fontSize: 32 }}>⚠️</span>
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>Что-то пошло не так</h2>
          <p
            style={{
              fontSize: 13,
              color: "var(--text-muted)",
              maxWidth: 400,
              textAlign: "center",
            }}
          >
            {this.state.error?.message || "Неизвестная ошибка"}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              marginTop: 8,
              padding: "6px 16px",
              fontSize: 13,
              background: "var(--accent-blue)",
              color: "#fff",
              border: "none",
              borderRadius: "var(--radius-md)",
              cursor: "pointer",
            }}
          >
            Попробовать снова
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
