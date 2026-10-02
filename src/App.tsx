import { Component, useEffect, type ErrorInfo, type ReactNode } from "react";
import { t } from "./i18n";
import { ipc } from "./lib/ipc";
import { initStore, useAppStore } from "./stores/appStore";
import { OperatorWindow } from "./windows/OperatorWindow";
import { ProjectionWindow } from "./windows/ProjectionWindow";

const view = new URLSearchParams(window.location.search).get("view") === "projection" ? "projection" : "operator";
document.documentElement.dataset.view = view;

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    void ipc.logFrontend("error", `${error.message}\n${info.componentStack ?? ""}`).catch(() => undefined);
  }

  render() {
    if (!this.state.error) return this.props.children;
    // En la proyección nunca se muestra un error: solo negro.
    if (view === "projection") return <div className="projection-root" />;
    return (
      <main className="fatal">
        <h1>{t("unexpectedError")}</h1>
        <pre>{this.state.error.message}</pre>
        <button type="button" className="button button--primary" onClick={() => window.location.reload()}>
          {t("reload")}
        </button>
      </main>
    );
  }
}

function Root() {
  const ready = useAppStore((s) => s.ready);
  const fatalError = useAppStore((s) => s.fatalError);
  useEffect(() => {
    void initStore();
  }, []);
  if (!ready) return view === "projection" ? <div className="projection-root" /> : <div className="splash">{t("loading")}</div>;
  if (fatalError) {
    if (view === "projection") return <div className="projection-root" />;
    return (
      <main className="fatal">
        <h1>{t("unexpectedError")}</h1>
        <pre>{fatalError}</pre>
        <p className="fatal__hint">{t("logHint")}</p>
        <button type="button" className="button button--primary" onClick={() => window.location.reload()}>
          {t("reload")}
        </button>
      </main>
    );
  }
  return view === "projection" ? <ProjectionWindow /> : <OperatorWindow />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  );
}
