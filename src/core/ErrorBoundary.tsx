import { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
}
interface State {
  hasError: boolean;
  message?: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error("ErrorBoundary caught:", error, info);
  }

  handleReset = () => {
    this.setState({ hasError: false, message: undefined });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
          <div className="panel max-w-md w-full p-8 text-center fade-in">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-danger-50 text-danger-600">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <h2 className="text-lg font-semibold text-slate-900">Something went wrong</h2>
            <p className="mt-2 text-sm text-slate-500">
              An unexpected error occurred while rendering this view. You can try reloading it.
            </p>
            {this.state.message && (
              <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs font-mono text-slate-600 text-left break-all">
                {this.state.message}
              </p>
            )}
            <button onClick={this.handleReset} className="btn-primary mt-5 mx-auto">
              <RefreshCw className="h-4 w-4" />
              Reload view
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
