import { Component, type ErrorInfo, type ReactNode } from 'react';

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('BukuKu error:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-[#F8F7F4] flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl border border-[#E5E2DC] bg-white p-6 space-y-3 text-center">
            <h1 className="font-serif text-xl font-bold text-[#18181B]">
              Terjadi kesalahan pada tampilan
            </h1>
            <p className="text-sm text-[#57534E]">
              Data Anda tetap tersimpan di perangkat ini. Muat ulang halaman untuk melanjutkan.
              Jika masalah berulang, unduh backup dari menu Pengaturan setelah aplikasi terbuka.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="min-h-[44px] rounded-lg bg-[#14532D] px-4 py-2 text-sm font-semibold text-white hover:bg-[#166534]"
            >
              Muat Ulang Aplikasi
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
