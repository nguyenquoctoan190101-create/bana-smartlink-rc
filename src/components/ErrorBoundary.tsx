import React, { ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  props: Props;

  constructor(props: Props) {
    super(props);
    this.props = props;
  }

  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[Uncaught React Error]", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
          <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-xl max-w-lg w-full text-center space-y-6">
            <div className="w-16 h-16 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-8 h-8">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
              </svg>
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-bold text-slate-800">Đã xảy ra lỗi khởi chạy giao diện</h2>
              <p className="text-sm text-slate-500">
                Ứng dụng gặp sự cố khi hiển thị trang. Dữ liệu nháp trên thiết bị không bị tự động xóa.
              </p>
            </div>
            
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                onClick={() => window.location.reload()}
                className="bg-emerald-800 hover:bg-emerald-950 text-white font-bold py-2.5 px-6 rounded-xl text-sm transition-all cursor-pointer"
              >
                Thử tải lại trang
              </button>
            </div>
            
            <p className="text-xs text-slate-400">
              Nếu lỗi tiếp diễn, hãy ghi lại thời điểm xảy ra lỗi và liên hệ quản trị hệ thống.
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
