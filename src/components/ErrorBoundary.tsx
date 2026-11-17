import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'Une erreur inattendue est survenue.',
    };
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[100dvh] bg-slate-100 text-slate-950 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-300 bg-white p-6 space-y-4 text-center">
            <div className="w-12 h-12 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h1 className="text-lg font-bold text-slate-950 font-display">
              Problème de chargement
            </h1>
            <p className="text-xs text-slate-700 break-words">
              {this.state.message}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full min-h-[48px] px-4 rounded-xl bg-slate-950 text-white text-sm font-semibold hover:bg-slate-800 inline-flex items-center justify-center gap-2 cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Recharger l’application</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
