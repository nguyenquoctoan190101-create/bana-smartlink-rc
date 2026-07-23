import React, { useEffect, useState } from "react";
import { getAllReports, getLocalDrafts, deleteReport } from "./lib/db";
import { apiFetch, apiJson, toUserFacingError } from "./lib/apiClient";
import { useAuth } from "./lib/AuthContext";

import { ReportData, UserRole } from "./types";
import SyncStatus from "./components/SyncStatus";
import ChatWidget from "./components/ChatWidget";
import PrivacyPolicy from "./components/PrivacyPolicy";
import { Button, TopographicPattern, Wordmark } from "./components/ui";
import { useVillages } from "./lib/useVillages";
import { useReportPeriods } from "./lib/useReportPeriods";
import { getRoleLabel, getRoleScope } from "./lib/rolePresentation";
import { 
  BarChart3, 
  FileText, 
  Clock,
  RefreshCw,
  Shield,
  MessageSquare,
  UserCheck,
  Award,
  LogOut,
  User,
  Phone,
  Lock,
  Wifi,
  WifiOff,
  Plus,
  Bell,
  FileArchive,
  MapPinned,
  Radio,
  FileSearch,
  ChevronDown,
} from "lucide-react";

const Dashboard = React.lazy(() => import("./components/Dashboard"));
const ReportForm = React.lazy(() => import("./components/ReportForm"));
const CitizenProposal = React.lazy(() => import("./components/CitizenProposal"));
const ManageAccounts = React.lazy(() => import("./components/ManageAccounts"));
const ProgressDashboard = React.lazy(() => import("./components/ProgressDashboard"));
const PolicyScorecard = React.lazy(() => import("./components/PolicyScorecard"));
const CnscdImpact = React.lazy(() => import("./components/CnscdImpact"));
const CreatePeriod = React.lazy(() => import("./components/CreatePeriod"));
const PendingUpdates = React.lazy(() => import("./components/PendingUpdates"));
const PublicVillagePage = React.lazy(() => import("./components/PublicVillagePage"));
const OperationsCenter = React.lazy(() => import("./components/OperationsCenter"));
const LegacyBatchImport = React.lazy(() => import("./components/LegacyBatchImport"));
const KnowledgeCenter = React.lazy(() => import("./components/KnowledgeCenter"));
const CaseManagement = React.lazy(() => import("./components/CaseManagement"));
const PilotWorkbench = React.lazy(() => import("./components/PilotWorkbench"));
const RecordLookup = React.lazy(() => import("./components/RecordLookup"));

type AppTab = "dashboard" | "progress-dashboard" | "report-form" | "citizen-proposal" | "admin-panel" | "policy-scorecard" | "cnscd-impact" | "create-period" | "pending-updates" | "operations" | "legacy-import" | "knowledge" | "cases" | "pilots" | "record-lookup";

const LoadingPanel = () => (
  <div role="status" className="flex min-h-48 items-center justify-center gap-2 text-sm font-semibold text-slate-600">
    <RefreshCw aria-hidden="true" className="h-5 w-5 animate-spin text-emerald-800" />
    Đang tải chức năng…
  </div>
);

const GovernmentEmblem = ({ className = "w-10 h-10" }: { className?: string }) => (
  <svg viewBox="0 0 100 100" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* Red circular background with double gold borders */}
    <circle cx="50" cy="50" r="46" fill="#D32F2F" stroke="#FBC02D" strokeWidth="2.5" />
    <circle cx="50" cy="50" r="41" stroke="#FBC02D" strokeWidth="0.75" strokeDasharray="2,2" opacity="0.85" />
    
    {/* Inner gear circle */}
    <circle cx="50" cy="50" r="32" stroke="#FBC02D" strokeWidth="0.5" opacity="0.5" />

    {/* Center Star */}
    <path d="M50 20 L54.5 35 L70 35 L57.5 44 L62 59 L50 50 L38 59 L42.5 44 L30 35 L45.5 35 Z" fill="#FBC02D" />
    
    {/* Rice Ears (Bông lúa) surrounding the star */}
    <path d="M22 64 C 18 46, 32 30, 48 29 M78 64 C 82 46, 68 30, 52 29" stroke="#FBC02D" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    {/* Rice grains */}
    <circle cx="21" cy="52" r="1.5" fill="#FBC02D" />
    <circle cx="23" cy="44" r="1.5" fill="#FBC02D" />
    <circle cx="27" cy="37" r="1.5" fill="#FBC02D" />
    <circle cx="33" cy="32" r="1.5" fill="#FBC02D" />
    <circle cx="41" cy="29" r="1.5" fill="#FBC02D" />
    
    <circle cx="79" cy="52" r="1.5" fill="#FBC02D" />
    <circle cx="77" cy="44" r="1.5" fill="#FBC02D" />
    <circle cx="73" cy="37" r="1.5" fill="#FBC02D" />
    <circle cx="67" cy="32" r="1.5" fill="#FBC02D" />
    <circle cx="59" cy="29" r="1.5" fill="#FBC02D" />

    {/* Gear Wheel (Bánh răng) at bottom */}
    <circle cx="50" cy="74" r="9" fill="#FBC02D" />
    <circle cx="50" cy="74" r="5" fill="#D32F2F" stroke="#FBC02D" strokeWidth="1" />
    <path d="M50 63 L50 67 M50 81 L50 85 M39 74 L43 74 M57 74 L61 74" stroke="#FBC02D" strokeWidth="2" strokeLinecap="round" />
    
    {/* Ribbon (Dải băng) */}
    <path d="M26 71 C 36 81, 64 81, 74 71 L72 79 C 60 86, 40 86, 28 79 Z" fill="#D32F2F" stroke="#FBC02D" strokeWidth="1" />
    <path d="M28 75 C 38 82, 62 82, 72 75" stroke="#FBC02D" strokeWidth="0.5" fill="none" />
  </svg>
);

const BaNaLandscapeSVG = () => (
  <svg viewBox="0 0 500 500" className="w-full h-full object-cover opacity-85 select-none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="skyGrad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#064e3b" />
        <stop offset="40%" stopColor="#022c22" />
        <stop offset="100%" stopColor="#011c15" />
      </linearGradient>
      <linearGradient id="mountainGrad1" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#047857" stopOpacity="0.8" />
        <stop offset="100%" stopColor="#022c22" stopOpacity="0.9" />
      </linearGradient>
      <linearGradient id="mountainGrad2" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#059669" stopOpacity="0.6" />
        <stop offset="100%" stopColor="#011c15" stopOpacity="0.95" />
      </linearGradient>
      <linearGradient id="bridgeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#d97706" />
        <stop offset="50%" stopColor="#f59e0b" />
        <stop offset="100%" stopColor="#b45309" />
      </linearGradient>
    </defs>

    {/* Sky Background */}
    <rect width="500" height="500" fill="url(#skyGrad)" />

    {/* Glowing Sun/Moon */}
    <circle cx="250" cy="180" r="100" fill="#fbc02d" opacity="0.12" filter="blur(8px)" />
    <circle cx="250" cy="180" r="50" fill="#fbc02d" opacity="0.15" />

    {/* Far Mountains */}
    <path d="M 0 350 Q 120 220, 240 330 T 480 300 L 500 300 L 500 500 L 0 500 Z" fill="url(#mountainGrad2)" />

    {/* Near Mountains */}
    <path d="M -20 400 Q 150 280, 300 380 T 520 350 L 520 500 L -20 500 Z" fill="url(#mountainGrad1)" />

    {/* Golden Bridge hands */}
    <path d="M 120 420 C 130 390, 140 390, 145 375 C 150 360, 140 350, 145 340 C 150 330, 160 340, 165 355 C 170 370, 160 390, 175 410 Z" fill="#64748b" opacity="0.5" stroke="#475569" strokeWidth="1" />
    <path d="M 330 430 C 340 395, 345 390, 355 380 C 365 370, 355 355, 360 345 C 365 335, 375 345, 375 365 C 375 385, 365 405, 380 425 Z" fill="#64748b" opacity="0.5" stroke="#475569" strokeWidth="1" />

    {/* Bridge Walkway curve */}
    <path d="M 50 380 Q 250 310, 450 380" stroke="url(#bridgeGrad)" strokeWidth="6" fill="none" strokeLinecap="round" />
    <path d="M 50 385 Q 250 315, 450 385" stroke="#f59e0b" strokeWidth="1.5" fill="none" opacity="0.6" />

    {/* Cable Car Line */}
    <line x1="0" y1="120" x2="500" y2="220" stroke="#94a3b8" strokeWidth="1" strokeDasharray="5,5" opacity="0.4" />
    
    <g transform="translate(150, 150) scale(0.6)">
      <rect x="0" y="0" width="20" height="15" rx="3" fill="#d32f2f" />
      <rect x="3" y="3" width="6" height="5" fill="#f1f5f9" />
      <rect x="11" y="3" width="6" height="5" fill="#f1f5f9" />
      <line x1="10" y1="0" x2="10" y2="-15" stroke="#475569" strokeWidth="1.5" />
    </g>
    <g transform="translate(320, 184) scale(0.6)">
      <rect x="0" y="0" width="20" height="15" rx="3" fill="#fbc02d" />
      <rect x="3" y="3" width="6" height="5" fill="#f1f5f9" />
      <rect x="11" y="3" width="6" height="5" fill="#f1f5f9" />
      <line x1="10" y1="0" x2="10" y2="-15" stroke="#475569" strokeWidth="1.5" />
    </g>
  </svg>
);

export default function App() {
  const {
    isLoggedIn,
    userRole,
    userVillageId,
    userName,
    userPhone,
    loginPhone,
    loginPassword,
    loginError,
    publicMode,
    isAuthLoading,
    requiresPasswordReset,
    setLoginPhone,
    setLoginPassword,
    setLoginError,
    setPublicMode,
    handleLoginSubmit,
    handlePasswordChange,
    handleLogout,
  } = useAuth();
  const { villages } = useVillages();
  const { periods } = useReportPeriods();
  const activePeriodId = periods[0]?.id || "";

  const [reports, setReports] = useState<ReportData[]>([]);
  const [activeTab, setActiveTab] = useState<AppTab>("dashboard");
  const [editingReport, setEditingReport] = useState<ReportData | null>(null);
  const [requestedPeriodId, setRequestedPeriodId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);

  const [showPrivacy, setShowPrivacy] = useState<boolean>(false);
  const [newPassword, setNewPassword] = useState("");
  const [passwordResetMessage, setPasswordResetMessage] = useState<string | null>(null);

  // --- NOTIFICATION HISTORY STATES ---
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [showNotifDropdown, setShowNotifDropdown] = useState<boolean>(false);
  const [showRoleScope, setShowRoleScope] = useState<boolean>(false);

  const fetchNotifications = async () => {
    if (!isLoggedIn || userRole === "dan") return;
    try {
      const res = await apiFetch("/api/notifications");
      if (res.ok) {
        const data = await res.json();
        setNotifications(data);
        setUnreadCount(data.filter((n: any) => !n.is_read).length);
      }
    } catch (e) {
      console.error("Lỗi lấy lịch sử thông báo:", e);
    }
  };

  useEffect(() => {
    if (isLoggedIn && userRole !== "dan") {
      fetchNotifications();
      const interval = window.setInterval(() => {
        if (document.visibilityState === "visible") void fetchNotifications();
      }, 30000);
      return () => window.clearInterval(interval);
    }
  }, [isLoggedIn, userRole]);

  const handleMarkAsRead = async (id: string, url?: string) => {
    try {
      const res = await apiFetch(`/api/notifications/${id}/read`, {
        method: "POST"
      });
      if (res.ok) {
        setNotifications(prev => 
          prev.map(n => n.id === id ? { ...n, is_read: true } : n)
        );
        setUnreadCount(prev => Math.max(0, prev - 1));
      }
    } catch (e) {
      console.error("Lỗi đánh dấu đã đọc:", e);
    }

    if (url) {
      setShowNotifDropdown(false);
      if (url.includes("report-form")) {
        const target = new URL(url, window.location.origin);
        changeTab("report-form", target.searchParams);
      } else if (url.includes("pending-updates")) {
        changeTab("pending-updates");
      } else if (url.includes("/app/cases")) {
        changeTab("cases");
      } else if (url.includes("dashboard")) {
        changeTab("dashboard");
      }
    }
  };


  // Network monitor
  useEffect(() => {
    const updateOnline = () => setIsOnline(navigator.onLine);
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, []);

  // Synchronize tab state with URL path
  const changeTab = (tab: AppTab, search = new URLSearchParams()) => {
    const roleTabs: Record<UserRole, Set<string>> = {
      admin_xa: new Set(["dashboard", "progress-dashboard", "policy-scorecard", "cnscd-impact", "create-period", "admin-panel", "pending-updates", "operations", "legacy-import", "knowledge", "cases", "pilots", "record-lookup"]),
      can_bo_thon: new Set(["dashboard", "report-form", "citizen-proposal", "operations", "knowledge", "cases", "record-lookup"]),
      to_cnscd: new Set(["dashboard", "report-form", "citizen-proposal", "operations", "knowledge", "cases", "record-lookup"]),
      lanh_dao: new Set(["dashboard", "progress-dashboard", "policy-scorecard", "cnscd-impact", "operations", "knowledge", "cases", "pilots", "record-lookup"]),
      dan: new Set(["dashboard", "citizen-proposal", "record-lookup"]),
    };
    if (!roleTabs[userRole].has(tab)) tab = "dashboard";
    if (tab === "report-form") {
      setRequestedPeriodId(search.get("period_id") || search.get("period"));
    }
    setActiveTab(tab);
    const suffix = search.toString() ? `?${search.toString()}` : "";
    window.history.pushState({ tab }, "", `/app/${tab}${suffix}`);
  };

  // Restore deep links and browser back/forward navigation.
  useEffect(() => {
    const roleTabs: Record<UserRole, Set<string>> = {
      admin_xa: new Set(["dashboard", "progress-dashboard", "policy-scorecard", "cnscd-impact", "create-period", "admin-panel", "pending-updates", "operations", "legacy-import", "knowledge", "cases", "pilots", "record-lookup"]),
      can_bo_thon: new Set(["dashboard", "report-form", "citizen-proposal", "operations", "knowledge", "cases", "record-lookup"]),
      to_cnscd: new Set(["dashboard", "report-form", "citizen-proposal", "operations", "knowledge", "cases", "record-lookup"]),
      lanh_dao: new Set(["dashboard", "progress-dashboard", "policy-scorecard", "cnscd-impact", "operations", "knowledge", "cases", "pilots", "record-lookup"]),
      dan: new Set(["dashboard", "citizen-proposal", "record-lookup"]),
    };
    const validTabs = new Set(["dashboard", "progress-dashboard", "report-form", "citizen-proposal", "admin-panel", "policy-scorecard", "cnscd-impact", "create-period", "pending-updates", "operations", "legacy-import", "knowledge", "cases", "pilots", "record-lookup"]);
    const restore = () => {
      const pathTab = window.location.pathname.match(/^\/app\/([^/]+)$/)?.[1];
      const legacyTab = new URLSearchParams(window.location.search).get("tab");
      const target = pathTab || legacyTab;
      if (target && validTabs.has(target) && roleTabs[userRole].has(target)) {
        setActiveTab(target as typeof activeTab);
        setRequestedPeriodId(target === "report-form"
          ? new URLSearchParams(window.location.search).get("period_id") || new URLSearchParams(window.location.search).get("period")
          : null);
      }
      else if (!roleTabs[userRole].has(activeTab)) setActiveTab("dashboard");
    };
    restore();
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [userRole]);

  // The public portal owns its public-data request. Loading the same endpoint
  // here as well caused duplicate requests and a misleading transient error
  // while a free-tier instance was waking up.
  useEffect(() => {
    if (isAuthLoading) return;
    if (!isLoggedIn || userRole === "dan") {
      setReports([]);
      setIsLoading(false);
      return;
    }

    const initApp = async () => {
      try {
        await loadAllReports();
      } catch (e) {
        console.error("[App] Gặp lỗi nghiêm trọng trong quá trình tải dữ liệu:", e);
      } finally {
        setIsLoading(false);
      }
    };
    void initApp();
  }, [isAuthLoading, isLoggedIn, userRole, userVillageId]);

  const loadAllReports = async () => {
    try {
      const remote = await getAllReports(!isLoggedIn || userRole === "dan");
      const drafts = isLoggedIn && userRole !== "dan" ? await getLocalDrafts() : [];
      // Keep device drafts separate even when they originated from a server
      // report. A local edit must never hide or replace the last server state.
      const all = [...drafts, ...remote];
      all.sort((a, b) => {
        const dateA = a.updated_at || "";
        const dateB = b.updated_at || "";
        return dateB.localeCompare(dateA);
      });
      setReports(all);
    } catch (e) {
      console.error("Lỗi tải báo cáo:", e);
    }
  };

  // Route back to dashboard upon successful login or guest entry
  useEffect(() => {
    if (isLoggedIn) {
      setActiveTab(userRole === "dan" ? "dashboard" : "operations");
    } else {
      setEditingReport(null);
    }
  }, [isLoggedIn]);

  const handleEditReport = (report: ReportData) => {
    setEditingReport(report);
    setRequestedPeriodId(null);
    changeTab("report-form");
  };

  const handleDeleteReport = async (id: string, localOnly = false) => {
    const confirmation = localOnly
      ? "Bạn có chắc chắn muốn xóa bản nháp này khỏi thiết bị?"
      : "Bạn có chắc chắn muốn xóa báo cáo này khỏi hệ thống?";
    if (window.confirm(confirmation)) {
      try {
        if (localOnly) {
          await deleteReport(id);
        } else {
          await apiJson<void>(`/reports/${id}`, { method: "DELETE" });
        }
        await loadAllReports();
      } catch (e) {
        console.error("Lỗi xóa báo cáo:", e);
      }
    }
  };

  const handleApproveReport = async (id: string) => {
    if (window.confirm("Bạn xác nhận duyệt báo cáo này?")) {
      try {
        const response = await apiFetch(`/reports/${id}/approve`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "approve" })
        });
        if (!response.ok) {
          const errorData = await response.json();
          alert("Lỗi duyệt báo cáo: " + (errorData.detail || "Không xác định"));
          return;
        }
        await loadAllReports();
      } catch (e) {
        console.error("Lỗi duyệt báo cáo:", e);
        alert("Lỗi mạng khi duyệt báo cáo.");
      }
    }
  };

  const handleLockReport = async (id: string) => {
    if (window.confirm("Bạn xác nhận khóa báo cáo này? (Sau khi khóa sẽ không thể sửa đổi)")) {
      try {
        const response = await apiFetch(`/reports/${id}/approve`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "lock" })
        });
        if (!response.ok) {
          const errorData = await response.json();
          alert("Lỗi khóa báo cáo: " + (errorData.detail || "Không xác định"));
          return;
        }
        await loadAllReports();
      } catch (e) {
        console.error("Lỗi khóa báo cáo:", e);
        alert("Lỗi mạng khi khóa báo cáo.");
      }
    }
  };

  const handleSavedReport = async () => {
    await loadAllReports();
    setEditingReport(null);
    setRequestedPeriodId(null);
    changeTab("dashboard");
  };

  const handleCancelForm = () => {
    setEditingReport(null);
    setRequestedPeriodId(null);
    changeTab("dashboard");
  };

  // -------------------------------------------------------------
  // RENDERING PUBLIC PORTAL / LOGIN SCREEN
  // -------------------------------------------------------------
  if (!isLoggedIn) {
    if (publicMode === "public") {
      return (
        <div className="min-h-screen bg-[#f6f8f7] flex flex-col font-sans antialiased text-slate-800">
          {/* Public Header */}
          <header className="bg-white/95 backdrop-blur-md border-b border-slate-200 sticky top-0 z-50">
            <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 min-h-20 flex items-center justify-between gap-4">
              <Wordmark />
              <Button
                onClick={() => setPublicMode("login")}
                variant="secondary"
                className="shrink-0"
              >
                <Lock className="w-4 h-4" />
                <span className="hidden sm:inline">Đăng nhập cán bộ</span>
                <span className="sm:hidden">Đăng nhập</span>
              </Button>
            </div>
          </header>

          {/* Main content */}
          <main className="flex-1 py-6 md:py-10 px-4 sm:px-6 lg:px-10">
            <React.Suspense fallback={<LoadingPanel />}>
              <PublicVillagePage onGoToLogin={() => setPublicMode("login")} />
            </React.Suspense>
          </main>

          {/* Public Footer */}
          <footer className="bg-[#10241e] text-slate-300 text-center py-7 px-4 border-t border-emerald-900 text-xs space-y-3">
            <div className="font-semibold">
              © 2026 UBND xã Bà Nà · Bà Nà SmartLink
            </div>
            <div className="flex justify-center items-center gap-2 text-slate-500 normal-case text-xs">
              <button 
                onClick={() => setShowPrivacy(true)}
                className="hover:text-emerald-450 text-slate-400 font-semibold transition-colors underline cursor-pointer"
              >
                Thông báo Bảo mật & Quyền riêng tư (dự thảo)
              </button>
            </div>
          </footer>

          {/* Smart Chatbot Widget cho dân chưa đăng nhập */}
          <ChatWidget userPhone={null} />
          
          {/* Privacy Policy Modal overlay */}
          {showPrivacy && (
            <PrivacyPolicy isModal={true} onClose={() => setShowPrivacy(false)} />
          )}
        </div>
      );
    }

    return (
      <div className="min-h-screen flex flex-col lg:flex-row font-sans antialiased text-slate-800 bg-[#f6f8f7]">
        
        {/* LEFT COLUMN: Visual Showcase & Brand illustration */}
        <div className="hidden lg:flex lg:w-[58%] bg-[#0b4437] relative flex-col justify-between p-12 xl:p-16 overflow-hidden text-white">
          <TopographicPattern className="text-white" />
          
          {/* Top left overlay metadata */}
          <div className="relative z-10">
            <Wordmark inverse />
          </div>

          {/* Bottom text overlay */}
          <div className="relative z-10 max-w-2xl pb-6">
            <p className="mb-4 text-sm font-semibold text-emerald-100">Ủy ban nhân dân xã Bà Nà</p>
            <h1 className="text-3xl xl:text-5xl font-bold text-white leading-[1.12] tracking-[-0.04em]">
              Dữ liệu rõ ràng.<br />Điều hành đúng việc.
            </h1>
            <p className="mt-5 text-base text-emerald-50 leading-relaxed max-w-xl">
              Một không gian làm việc thống nhất để cán bộ nhập liệu, rà soát, phê duyệt và theo dõi tiến độ báo cáo của 10 thôn.
            </p>
            <div className="grid grid-cols-3 gap-6 mt-8 pt-6 border-t border-white/15">
              <div>
                <b className="text-2xl font-bold text-white">10</b>
                <p className="mt-1 text-xs text-emerald-100">Thôn trong phạm vi</p>
              </div>
              <div>
                <b className="text-2xl font-bold text-white">14</b>
                <p className="mt-1 text-xs text-emerald-100">Chỉ tiêu nghiệp vụ</p>
              </div>
              <div>
                <b className="text-2xl font-bold text-white">5</b>
                <p className="mt-1 text-xs text-emerald-100">Chỉ tiêu công khai</p>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: The Login Form */}
        <div className="w-full lg:w-[42%] bg-[#f6f8f7] flex flex-col justify-center px-5 py-10 sm:px-12 lg:px-14 relative overflow-hidden">
          <TopographicPattern className="text-emerald-800 lg:hidden" />
          
          {/* Logo showing up for mobile screen only */}
          <div className="block lg:hidden mb-10 relative z-10">
            <Wordmark />
          </div>

          <div className="relative z-10 w-full max-w-md mx-auto bg-white p-6 sm:p-8 border border-[#dfe6e3] rounded-xl shadow-sm space-y-6">
            <form onSubmit={handleLoginSubmit} className="space-y-5">
              <div>
                <p className="text-xs font-bold text-emerald-800">KHU VỰC NỘI BỘ</p>
                <h1 className="mt-2 text-2xl font-bold text-slate-900 tracking-tight">Đăng nhập cán bộ</h1>
                <p className="mt-2 text-sm text-slate-600">Sử dụng tài khoản được UBND xã cấp để truy cập đúng phạm vi công việc.</p>
              </div>

              {loginError && (
                <div role="alert" className="p-3.5 bg-rose-50 border border-rose-200 text-rose-800 text-sm font-semibold rounded-lg">
                  {loginError}
                </div>
              )}

              {/* SĐT Input */}
              <div className="space-y-1.5">
                <label className="block text-sm font-semibold text-slate-700">Số điện thoại</label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-500 pointer-events-none">
                    <Phone className="w-5 h-5" />
                  </span>
                  <input
                    type="tel"
                    required
                    placeholder="Nhập số điện thoại đăng ký..."
                    value={loginPhone}
                    onChange={(e) => setLoginPhone(e.target.value)}
                    className="w-full pl-11!"
                  />
                </div>
              </div>

              {/* Mật khẩu Input */}
              <div className="space-y-1.5">
                <label className="block text-sm font-semibold text-slate-700">Mật khẩu</label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-500 pointer-events-none">
                    <Lock className="w-5 h-5" />
                  </span>
                  <input
                    type="password"
                    required
                    placeholder="Nhập mật khẩu truy cập..."
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    className="w-full pl-11!"
                  />
                </div>
              </div>

              {/* Submit Button (Gov Blue theme) */}
              <button
                type="submit"
                className="button button--primary w-full"
              >
                Đăng nhập
              </button>
            </form>

            <div className="relative">
                <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-200"></div>
              </div>
              <div className="relative flex justify-center text-xs font-bold uppercase">
                <span className="bg-white px-3 text-slate-500 rounded-full">Hoặc</span>
              </div>
            </div>

            {/* Guest Citizen Entry */}
            <div className="space-y-3">
              <p className="text-sm text-slate-600 text-center leading-relaxed">
                Người dân không cần tài khoản để xem dữ liệu công khai và gửi kiến nghị.
              </p>
              <button
                type="button"
                onClick={() => setPublicMode("public")}
                className="button button--secondary w-full"
              >
                <span>← Về cổng thông tin công khai</span>
              </button>
            </div>

            <div className="mt-6 text-center text-xs text-slate-500">
              <button 
                onClick={() => setShowPrivacy(true)}
                className="hover:text-emerald-800 transition-colors underline cursor-pointer font-semibold"
              >
                Thông báo Bảo mật & Quyền riêng tư (dự thảo)
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (requiresPasswordReset) {
    return (
      <main className="min-h-screen bg-emerald-950 flex items-center justify-center p-4">
        <form
          className="w-full max-w-md rounded-2xl bg-white p-6 space-y-5 shadow-2xl"
          onSubmit={async (event) => {
            event.preventDefault();
            setPasswordResetMessage(null);
            try {
              await handlePasswordChange(newPassword);
              setNewPassword("");
            } catch (error) {
              setPasswordResetMessage(toUserFacingError(error, "Không thể đổi mật khẩu. Vui lòng kiểm tra lại và thử lại."));
            }
          }}
        >
          <div>
            <h1 className="text-xl font-bold text-slate-900">Đổi mật khẩu bắt buộc</h1>
            <p className="mt-2 text-sm text-slate-600">Tài khoản đang dùng mật khẩu tạm. Hãy đặt mật khẩu mới trước khi truy cập dữ liệu.</p>
          </div>
          {passwordResetMessage && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{passwordResetMessage}</p>}
          <div>
            <label htmlFor="new-password" className="block text-sm font-semibold text-slate-700">Mật khẩu mới</label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              className="mt-2 w-full"
            />
            <p className="mt-1 text-sm text-slate-500">Tối thiểu 12 ký tự.</p>
          </div>
          <div className="flex gap-3">
            <button type="submit" className="min-h-11 flex-1 rounded-xl bg-emerald-800 px-4 py-2 font-bold text-white">Lưu mật khẩu</button>
            <button type="button" onClick={handleLogout} className="min-h-11 rounded-xl border border-slate-300 px-4 py-2 font-bold text-slate-700">Đăng xuất</button>
          </div>
        </form>
      </main>
    );
  }

  // -------------------------------------------------------------
  // PREPARING SIDEBAR / BOTTOM MENU DEFINITIONS
  // -------------------------------------------------------------
  
  // Tab menu definition for each role
  const getNavItems = (): { id: typeof activeTab; label: string; icon: any; group?: string }[] => {
    switch (userRole) {
      case "admin_xa":
        return [
          { id: "operations", label: "Hộp việc điều hành", icon: UserCheck, group: "Công việc" },
          { id: "pending-updates", label: "Duyệt kiến nghị", icon: MessageSquare },
          { id: "cases", label: "Xử lý phản ánh", icon: MapPinned },
          { id: "record-lookup", label: "Tra cứu hồ sơ", icon: FileSearch },
          { id: "dashboard", label: "Tổng hợp số liệu", icon: BarChart3, group: "Báo cáo & phê duyệt" },
          { id: "progress-dashboard", label: "Tiến độ 10 thôn", icon: Clock },
          { id: "policy-scorecard", label: "Đối chiếu KH02", icon: Award, group: "Điều hành" },
          { id: "cnscd-impact", label: "Hiệu quả CNSCĐ", icon: UserCheck },
          { id: "create-period", label: "Tạo kỳ báo cáo", icon: Plus, group: "Quản trị" },
          { id: "legacy-import", label: "Nhập 22 thôn cũ", icon: FileArchive },
          { id: "admin-panel", label: "Tài khoản cán bộ", icon: Shield },
          { id: "knowledge", label: "Kho tri thức & kịch bản", icon: FileArchive, group: "Năng lực" },
          { id: "pilots", label: "Pilot IoT & du lịch", icon: Radio, group: "Thí điểm" }
        ];
      case "can_bo_thon":
      case "to_cnscd":
        return [
          { id: "operations", label: "Việc của tôi", icon: UserCheck, group: "Công việc" },
          { id: "cases", label: "Phản ánh hiện trường", icon: MapPinned },
          { id: "report-form", label: "Nhập báo cáo", icon: FileText },
          { id: "dashboard", label: "Dữ liệu của thôn", icon: BarChart3, group: "Theo dõi" },
          { id: "citizen-proposal", label: "Đề nghị sửa số liệu", icon: MessageSquare },
          { id: "record-lookup", label: "Tra cứu hồ sơ", icon: FileSearch },
          { id: "knowledge", label: "Kho tri thức", icon: FileArchive, group: "Năng lực" }
        ];
      case "lanh_dao":
        return [
          { id: "operations", label: "Brief quyết định", icon: UserCheck, group: "Điều hành" },
          { id: "cases", label: "Giám sát phản ánh", icon: MapPinned },
          { id: "record-lookup", label: "Tra cứu hồ sơ", icon: FileSearch },
          { id: "dashboard", label: "Tổng hợp toàn xã", icon: BarChart3 },
          { id: "progress-dashboard", label: "Tiến độ 10 thôn", icon: Clock },
          { id: "policy-scorecard", label: "Đối chiếu KH02", icon: Award, group: "Đánh giá" },
          { id: "cnscd-impact", label: "Hiệu quả CNSCĐ", icon: UserCheck },
          { id: "knowledge", label: "Kho tri thức", icon: FileArchive, group: "Năng lực" },
          { id: "pilots", label: "Pilot IoT & du lịch", icon: Radio, group: "Thí điểm" }
        ];
      case "dan":
      default:
        return [
          { id: "dashboard", label: "Thông tin thôn", icon: BarChart3 },
          { id: "citizen-proposal", label: "Đề nghị sửa số liệu", icon: MessageSquare },
          { id: "record-lookup", label: "Tra cứu hồ sơ", icon: FileSearch },
        ];
    }
  };

  const navItems = getNavItems();
  const activeNavItem = navItems.find((item) => item.id === activeTab);

  const mobileNavItems = navItems;

  return (
    <div className="gov-shell flex flex-col md:flex-row font-sans antialiased">
      
      {/* -------------------------------------------------------------
          DESKTOP SIDEBAR: FIXED LEFT SIDEBAR FOR DESKTOP
          ------------------------------------------------------------- */}
      <aside className="gov-shell__sidebar hidden md:flex flex-col shrink-0 sticky top-0 border-r border-white/10">
        <div className="gov-shell__sidebar-scroll flex min-h-0 flex-1 flex-col">
          {/* Header Branding */}
          <div className="p-5 border-b border-white/10">
            <Wordmark inverse />
          </div>

          {/* Active Logged-In User Profile */}
          <div className="p-4 mx-3 my-4 bg-white/6 border border-white/10 rounded-xl space-y-1 text-xs">
            <div className="flex items-center gap-2 text-white font-semibold">
              <User className="w-4 h-4 text-emerald-200" />
              <span>{userName}</span>
            </div>
            <div className="pl-6 space-y-1 text-emerald-100 text-xs">
              <p>{getRoleLabel(userRole)}</p>
              {userVillageId && (
                <p>Thôn phụ trách: <span className="font-bold text-white">
                  {villages.find((v) => v.id === userVillageId)?.name || "Thôn được phân công"}
                </span></p>
              )}
              <button
                type="button"
                onClick={() => setShowRoleScope((visible) => !visible)}
                aria-expanded={showRoleScope}
                className="mt-2 flex min-h-8 w-full items-center justify-between rounded-lg border border-white/10 px-2 py-1.5 text-left font-semibold text-white hover:bg-white/8"
              >
                <span>Phạm vi quyền</span>
                <ChevronDown aria-hidden="true" className={`h-4 w-4 transition-transform ${showRoleScope ? "rotate-180" : ""}`} />
              </button>
              {showRoleScope && <p className="rounded-lg bg-emerald-950/45 p-2 leading-relaxed text-emerald-50">{getRoleScope(userRole)}</p>}
            </div>
          </div>

          {/* Left Navigation Items */}
          <nav className="px-3 pb-4 space-y-1" aria-label="Điều hướng nghiệp vụ">
            {navItems.map((item) => {
              const IconComp = item.icon;
              return (<React.Fragment key={item.id}>
                {item.group && <p className="gov-nav-group">{item.group}</p>}
                <button
                  onClick={() => {
                    setEditingReport(null);
                    changeTab(item.id);
                  }}
                  aria-current={activeTab === item.id ? "page" : undefined}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${
                    activeTab === item.id
                      ? "bg-white text-emerald-950"
                      : "text-emerald-100 hover:bg-white/8 hover:text-white"
                  }`}
                >
                  <IconComp className="w-5 h-5 shrink-0" />
                  <span>{item.label}</span>
                </button>
              </React.Fragment>);
            })}
          </nav>
        </div>

        {/* Footer actions with Logout */}
        <div className="shrink-0 p-4 border-t border-emerald-900 space-y-2">
          {/* Offline indicator for desktop sidebar */}
          <div className="flex items-center justify-between px-2 text-3xs font-semibold text-slate-300">
            <span className="flex items-center gap-1">
              {isOnline ? (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                  <span>Đang kết nối</span>
                </>
              ) : (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse"></span>
                  <span className="text-rose-300 font-bold">Lưu Offline</span>
                </>
              )}
            </span>
          </div>

          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-bold text-rose-300 bg-emerald-900/40 hover:bg-rose-950/20 hover:text-rose-200 border border-emerald-900/60 transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>ĐĂNG XUẤT</span>
          </button>
        </div>
      </aside>

      {/* -------------------------------------------------------------
          MOBILE HEADER: TOP BAR FOR MOBILE DEVICES
          ------------------------------------------------------------- */}
      <header className="block md:hidden bg-[#0b3d32] text-white sticky top-0 z-40 border-b border-white/10">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="min-w-0">
            <Wordmark compact inverse />
          </div>

          <div className="flex items-center gap-2.5">
            {/* Quick Offline Status Badge */}
            {!isOnline && (
              <span className="flex items-center gap-1 bg-rose-900/80 border border-rose-800 px-2 py-1 rounded-md text-4xs font-bold text-rose-100 animate-pulse">
                <WifiOff className="w-3 h-3" />
                <span>Đã lưu offline</span>
              </span>
            )}

            {isOnline && (
              <span className="flex items-center gap-1 bg-emerald-900/80 border border-emerald-800 px-2 py-1 rounded-md text-4xs font-bold text-emerald-300">
                <Wifi className="w-3 h-3" />
                <span>Đang Online</span>
              </span>
            )}

            {/* Notification Bell for Mobile */}
            {isLoggedIn && userRole !== "dan" && (
              <div className="relative">
                <button
                  onClick={() => setShowNotifDropdown(!showNotifDropdown)}
                  className="relative p-1.5 bg-emerald-900 hover:bg-emerald-850 rounded-lg text-white cursor-pointer"
                  title="Thông báo"
                >
                  <Bell className="w-4 h-4" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 bg-rose-600 text-white text-[9px] font-bold w-4 h-4 flex items-center justify-center rounded-full border border-emerald-950">
                      {unreadCount}
                    </span>
                  )}
                </button>

                {showNotifDropdown && (
                  <div className="absolute right-0 mt-2 w-72 bg-white rounded-xl shadow-xl border border-slate-150 py-1.5 z-50 text-slate-800">
                    <div className="px-3.5 py-1.5 border-b border-slate-100 flex items-center justify-between">
                      <span className="font-extrabold text-[10px] uppercase text-slate-900">Thông báo ({unreadCount})</span>
                    </div>
                    <div className="max-h-60 overflow-y-auto divide-y divide-slate-100">
                      {notifications.length === 0 ? (
                        <div className="px-3 py-4 text-center text-slate-400 text-4xs font-bold">
                          Không có thông báo.
                        </div>
                      ) : (
                        notifications.map((notif) => (
                          <div 
                            key={notif.id}
                            onClick={() => handleMarkAsRead(notif.id, notif.url)}
                            className={`px-3 py-2 hover:bg-slate-50 cursor-pointer ${!notif.is_read ? "bg-slate-50/50" : ""}`}
                          >
                            <div className="flex items-start justify-between gap-1">
                              <span className="text-4xs font-bold text-slate-900">{notif.title}</span>
                              {!notif.is_read && <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 shrink-0 mt-1"></span>}
                            </div>
                            <p className="text-[10px] text-slate-500 font-semibold mt-0.5 leading-tight">{notif.body}</p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Logout trigger on mobile top header */}
            <button
              onClick={handleLogout}
              className="p-1.5 bg-emerald-900 hover:bg-emerald-800 text-rose-300 hover:text-rose-200 rounded-lg transition-colors cursor-pointer"
              title="Đăng xuất"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* -------------------------------------------------------------
          MAIN CONTENT CONTAINER: SCREEN FLOW
          ------------------------------------------------------------- */}
      <div className="gov-shell__main flex flex-col min-h-0">
        
        {/* Desktop Top Header Bar */}
        <header className="hidden md:flex bg-white border-b border-slate-200 px-8 py-3.5 min-h-16 items-center justify-between sticky top-0 z-40">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-500">Không gian làm việc</span>
            <span className="text-slate-300">/</span>
            <span className="text-sm font-bold text-slate-900">{activeNavItem?.label ?? "Tổng quan"}</span>
          </div>
          
          <div className="flex items-center gap-4">
            {/* Connection Status */}
            <span className="flex items-center gap-1.5 text-xs font-bold text-slate-600 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-xl">
              <span className={`w-2 h-2 rounded-full ${isOnline ? "bg-emerald-500" : "bg-rose-500 animate-pulse"}`}></span>
              <span>{isOnline ? "Đang Online" : "Ngoại tuyến"}</span>
            </span>

            {/* Notification Bell Dropdown Button */}
            {isLoggedIn && userRole !== "dan" && (
              <div className="relative">
                <button
                  onClick={() => setShowNotifDropdown(!showNotifDropdown)}
                  className="relative p-2 text-slate-600 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 rounded-xl transition-all border border-slate-200 cursor-pointer focus:outline-none flex items-center justify-center"
                  title="Thông báo hệ thống"
                >
                  <Bell className="w-5 h-5" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 bg-rose-600 text-white text-[10px] font-black w-5 h-5 flex items-center justify-center rounded-full animate-bounce border-2 border-white shadow-xs">
                      {unreadCount}
                    </span>
                  )}
                </button>

                {showNotifDropdown && (
                  <div className="absolute right-0 mt-2 w-80 bg-white rounded-2xl shadow-xl border border-slate-150 py-2 z-50 animate-in fade-in slide-in-from-top-3 duration-200 text-slate-800">
                    <div className="px-4 py-2 border-b border-slate-100 flex items-center justify-between">
                      <span className="font-extrabold text-xs text-slate-900 uppercase tracking-tight">Thông báo ({unreadCount})</span>
                    </div>

                    <div className="max-h-72 overflow-y-auto divide-y divide-slate-50">
                      {notifications.length === 0 ? (
                        <div className="px-4 py-6 text-center text-slate-400 text-xs font-semibold">
                          Không có thông báo nào.
                        </div>
                      ) : (
                        notifications.map((notif) => (
                          <div 
                            key={notif.id}
                            onClick={() => handleMarkAsRead(notif.id, notif.url)}
                            className={`px-4 py-3 hover:bg-slate-25 transition-all cursor-pointer ${!notif.is_read ? "bg-slate-50/50" : ""}`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <span className={`text-xs font-bold text-slate-900 ${!notif.is_read ? "text-emerald-950 font-black" : "text-slate-600"}`}>
                                {notif.title}
                              </span>
                              {!notif.is_read && (
                                <span className="w-2 h-2 rounded-full bg-emerald-600 mt-1.5 shrink-0"></span>
                              )}
                            </div>
                            <p className="text-4xs text-slate-500 font-semibold mt-1 leading-normal">{notif.body}</p>
                            <span className="text-xs text-slate-500 font-medium mt-1 block">
                              {new Date(notif.created_at).toLocaleTimeString("vi-VN")} - {new Date(notif.created_at).toLocaleDateString("vi-VN")}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </header>
        


        {/* Sync Offline Queue Bar for Officers */}
        {userRole !== "dan" && userRole !== "lanh_dao" && (
          <div className="px-4 pt-4">
            <SyncStatus onSyncCompleted={loadAllReports} />
          </div>
        )}

        <main className="gov-shell__content flex-1 space-y-6">
          
          {(isLoading || isAuthLoading) ? (
            <div className="h-64 flex flex-col items-center justify-center text-slate-500">
              <RefreshCw className="w-8 h-8 animate-spin text-emerald-800 mb-2" />
              <p className="text-sm font-medium">Đang tải đồng bộ cơ sở dữ liệu địa phương...</p>
            </div>
          ) : (
            <React.Suspense fallback={<LoadingPanel />}>
              <div className="space-y-6">
              {activeTab === "dashboard" && (
                <>
                  <Dashboard 
                    reports={reports.filter(r => {
                      if (userRole === "admin_xa" || userRole === "lanh_dao") {
                        return true;
                      }
                      if (userRole === "can_bo_thon" || userRole === "to_cnscd") {
                        return r.village_id === userVillageId;
                      }
                      if (userRole === "dan") {
                        const matchesVillage = !userVillageId || r.village_id === userVillageId;
                        return matchesVillage && (r.status === "Submitted" || r.status === "Approved");
                      }
                      return true;
                    })} 
                    onEditReport={handleEditReport}
                    onDeleteReport={handleDeleteReport}
                    onApproveReport={userRole === "admin_xa" ? handleApproveReport : undefined}
                    onLockReport={userRole === "admin_xa" ? handleLockReport : undefined}
                    onAddNewReport={(periodId) => {
                      setEditingReport(null);
                      const search = new URLSearchParams();
                      if (periodId) search.set("period_id", periodId);
                      changeTab("report-form", search);
                    }}
                    userRole={userRole}
                    reportPeriods={periods}
                  />


                </>
              )}

              {activeTab === "progress-dashboard" && (
                activePeriodId ? <ProgressDashboard periodId={activePeriodId} /> : <p role="status">Chưa có kỳ báo cáo.</p>
              )}

              {activeTab === "policy-scorecard" && (
                <PolicyScorecard onBackToDashboard={() => changeTab("dashboard")} />
              )}

              {activeTab === "cnscd-impact" && (
                activePeriodId ? <CnscdImpact selectedPeriod={activePeriodId} /> : <p role="status">Chưa có kỳ báo cáo.</p>
              )}

              {activeTab === "operations" && (
                <OperationsCenter periodId={activePeriodId} role={userRole} />
              )}

              {activeTab === "knowledge" && (
                <KnowledgeCenter role={userRole} />
              )}

              {activeTab === "cases" && (
                <CaseManagement role={userRole} villages={villages} />
              )}

              {activeTab === "pilots" && (
                <PilotWorkbench role={userRole} />
              )}

              {activeTab === "record-lookup" && (
                <RecordLookup />
              )}

              {activeTab === "report-form" && (
                <ReportForm 
                  initialReport={editingReport}
                  initialPeriodId={requestedPeriodId}
                  onSaved={handleSavedReport}
                  onCancel={handleCancelForm}
                />
              )}

              {activeTab === "citizen-proposal" && (
                <CitizenProposal 
                  reports={reports.filter((report) => !report.local_only)}
                  onProposalSubmitted={loadAllReports}
                  onOpenFieldReport={() => changeTab("cases")}
                />
              )}

              {activeTab === "pending-updates" && (
                <PendingUpdates 
                  userRole={userRole}
                  userVillageId={userVillageId}
                  userName={userName || "Cán bộ"}
                  onUpdateProcessed={loadAllReports}
                />
              )}

              {activeTab === "admin-panel" && (
                <ManageAccounts />
              )}

              {activeTab === "create-period" && (
                <CreatePeriod />
              )}
              {activeTab === "legacy-import" && (
                <LegacyBatchImport />
              )}
              </div>
            </React.Suspense>
          )}

          {/* Universal Footer for Privacy Policy and info */}
          <footer className="pt-8 pb-4 mt-12 border-t border-slate-200 text-center text-xs text-slate-500 space-y-2">
            <div className="flex flex-wrap justify-center items-center gap-x-4 gap-y-1.5 font-bold text-slate-600">
              <button 
                onClick={() => setShowPrivacy(true)}
                className="hover:text-emerald-800 transition-colors underline cursor-pointer"
              >
                Chính sách Bảo mật & Quyền riêng tư
              </button>
              <span className="text-slate-300 font-normal">•</span>
              <span>Cần rà soát pháp lý trước khi vận hành thật</span>
              <span className="text-slate-300 font-normal">•</span>
              <span>Bà Nà SmartLink RC</span>
            </div>
            <p className="text-slate-400 font-medium text-[10px]">
              © 2026 Ủy ban Nhân dân xã Bà Nà, huyện Hòa Vang, TP. Đà Nẵng. Mọi quyền được bảo lưu.
            </p>
          </footer>
        </main>
      </div>

      {/* -------------------------------------------------------------
          MOBILE BOTTOM NAVIGATION: FLOATING STICKY NAVIGATION FOR PHONES
          ------------------------------------------------------------- */}
      <nav aria-label="Điều hướng chính trên thiết bị di động" className="md:hidden fixed bottom-0 left-0 right-0 z-45 bg-white border-t border-slate-200 px-1 py-1.5 shadow-lg flex items-center min-h-16 overflow-x-auto">
        {mobileNavItems.map((item) => {
          const IconComp = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => {
                setEditingReport(null);
                changeTab(item.id);
              }}
              aria-current={isActive ? "page" : undefined}
              className={`flex flex-col items-center justify-center min-w-20 min-h-12 px-2 py-1 text-center transition-all cursor-pointer ${
                isActive 
                  ? "text-emerald-800 font-bold scale-102" 
                  : "text-slate-400 font-medium hover:text-slate-600"
              }`}
            >
              <div className={`p-1 rounded-lg ${isActive ? "bg-emerald-50 text-emerald-800" : ""}`}>
                <IconComp className="w-5.5 h-5.5 shrink-0" />
              </div>
              <span className="text-xs tracking-tight mt-0.5 leading-tight">{item.label}</span>
            </button>
          );
        })}
      </nav>
      
      {/* Smart Chatbot Widget */}
      <ChatWidget userPhone={userPhone} />
      


      {/* Privacy Policy Modal overlay */}
      {showPrivacy && (
        <PrivacyPolicy isModal={true} onClose={() => setShowPrivacy(false)} />
      )}
    </div>
  );
}
