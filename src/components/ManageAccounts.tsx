import React, { useState, useEffect } from "react";
import { 
  Users, 
  UserPlus, 
  Shield, 
  Lock, 
  Unlock, 
  Mail, 
  Phone, 
  MapPin, 
  Search, 
  Plus, 
  RefreshCw, 
  AlertCircle, 
  CheckCircle,
  KeyRound,
  X
} from "lucide-react";
import { apiJson, toUserFacingError } from "../lib/apiClient";
import { useVillages } from "../lib/useVillages";
import "./ManageAccounts.css";
import { ErrorState, WorkSection } from "./ui";

type StaffRole = "can_bo_thon" | "to_cnscd" | "admin_xa" | "lanh_dao";
type StaffScope = "single_village" | "assigned_villages" | "commune";

interface Officer {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: StaffRole;
  village_id: string | null;
  village_ids: string[];
  is_active: boolean;
  last_login: string | null;
}

interface CreatedAccount {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: StaffRole;
  scope: StaffScope;
  village_id: string | null;
  village_ids: string[];
  temporary_password: string;
}

const ROLE_LABELS: Record<StaffRole, string> = {
  can_bo_thon: "Cán bộ thôn",
  to_cnscd: "Tổ công nghệ số cộng đồng",
  admin_xa: "Cán bộ xã",
  lanh_dao: "Lãnh đạo xã",
};

const COMMUNE_WIDE_ROLES = new Set<StaffRole>(["admin_xa", "lanh_dao"]);

export default function ManageAccounts() {
  const { villages: new_villages } = useVillages();
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [resetPasswordResult, setResetPasswordResult] = useState<{name: string, tempPass: string} | null>(null);

  // Form states for creating new account
  const [showCreateForm, setShowCreateForm] = useState<boolean>(false);
  const [name, setName] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [phone, setPhone] = useState<string>("");
  const [role, setRole] = useState<StaffRole>("can_bo_thon");
  const [selectedVillageIds, setSelectedVillageIds] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [createdAccount, setCreatedAccount] = useState<CreatedAccount | null>(null);

  // Filter and Search states
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [selectedVillageFilter, setSelectedVillageFilter] = useState<string>("all");
  const [selectedRoleFilter, setSelectedRoleFilter] = useState<string>("all");
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>("all");

  useEffect(() => {
    if (
      !COMMUNE_WIDE_ROLES.has(role) &&
      selectedVillageIds.length === 0 &&
      new_villages.length > 0
    ) {
      setSelectedVillageIds([new_villages[0].id]);
    }
  }, [new_villages, role, selectedVillageIds.length]);

  const handleRoleChange = (nextRole: StaffRole) => {
    setRole(nextRole);
    if (COMMUNE_WIDE_ROLES.has(nextRole)) {
      setSelectedVillageIds([]);
      return;
    }
    setSelectedVillageIds((current) => {
      const firstVillageId = current[0] || new_villages[0]?.id;
      if (!firstVillageId) return [];
      return nextRole === "can_bo_thon" ? [firstVillageId] : current.length ? current : [firstVillageId];
    });
  };

  const getVillageNames = (villageIds: string[]) =>
    villageIds.map(
      (villageId) =>
        new_villages.find((village) => village.id === villageId)?.name ||
        villageId,
    );

  const getScopeLabel = (accountRole: StaffRole, villageIds: string[]) => {
    if (COMMUNE_WIDE_ROLES.has(accountRole)) {
      return `Toàn xã${new_villages.length ? ` · ${new_villages.length}/${new_villages.length} thôn` : ""}`;
    }
    const villageNames = getVillageNames(villageIds);
    return villageNames.length ? villageNames.join(", ") : "Chưa xác định địa bàn";
  };

  // Fetch all accounts
  const fetchOfficers = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const resData = await apiJson<Officer[]>("/auth/officers");
      setOfficers(Array.isArray(resData) ? resData : []);
    } catch (err: any) {
      setLoadError(toUserFacingError(err, "Không thể tải danh sách tài khoản."));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchOfficers();
  }, []);

  // Toggle is_active status (Lock/Unlock)
  const handleToggleStatus = async (id: string, currentName: string, isCurrentlyActive: boolean) => {
    const actionLabel = isCurrentlyActive ? "khóa" : "mở khóa";
    if (
      !window.confirm(
        `Bạn xác nhận ${actionLabel} tài khoản của cán bộ ${currentName}? Thao tác sẽ được ghi vào nhật ký kiểm toán.`,
      )
    ) {
      return;
    }
    setError(null);
    setSuccess(null);
    try {
      const resData = await apiJson<{ is_active: boolean }>(`/auth/officers/${id}/toggle-active`, {
        method: "POST"
      });
      
      // Update local state
      setOfficers((prev) => 
        prev.map((o) => o.id === id ? { ...o, is_active: resData.is_active } : o)
      );

      setSuccess(`Đã ${isCurrentlyActive ? "khóa" : "kích hoạt lại"} tài khoản của cán bộ ${currentName}; thay đổi đã được ghi vào nhật ký kiểm toán.`);
      
      // Auto-clear success message after 5 seconds
      setTimeout(() => setSuccess(null), 5000);
    } catch (err: any) {
      setError(toUserFacingError(err, "Không thể cập nhật trạng thái tài khoản."));
    }
  };

  const handleResetPassword = async (id: string, name: string) => {
    if (!window.confirm(`Bạn có chắc chắn muốn cấp lại mật khẩu ngẫu nhiên cho cán bộ ${name}? Tài khoản sẽ bị bắt buộc đổi mật khẩu ở lần đăng nhập tới.`)) {
      return;
    }
    setError(null);
    setSuccess(null);
    setResetPasswordResult(null);
    try {
      const resData = await apiJson<{ temporary_password: string }>(`/auth/officers/${id}/reset-password`, {
        method: "POST"
      });
      setResetPasswordResult({ name, tempPass: resData.temporary_password });
      setSuccess(`Đã cấp lại mật khẩu cho cán bộ ${name} thành công.`);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err: any) {
      setError(toUserFacingError(err, "Không thể cấp lại mật khẩu."));
    }
  };

  // Submit and Create New Account
  const handleCreateAccountSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setCreatedAccount(null);
    setResetPasswordResult(null);

    if (!name.trim()) {
      setError("Vui lòng nhập họ tên cán bộ.");
      return;
    }
    if (!email.trim() || !email.includes("@")) {
      setError("Vui lòng nhập email hợp lệ.");
      return;
    }
    if (!phone.trim() || !/^\+?\d{9,11}$/.test(phone.trim())) {
      setError("Vui lòng nhập số điện thoại hợp lệ (9-11 chữ số).");
      return;
    }
    if (role === "can_bo_thon" && selectedVillageIds.length !== 1) {
      setError("Cán bộ thôn phải được giao đúng một thôn.");
      return;
    }
    if (role === "to_cnscd" && selectedVillageIds.length === 0) {
      setError("Vui lòng chọn ít nhất một thôn được giao cho thành viên CNSCĐ.");
      return;
    }

    setIsSubmitting(true);

    try {
      const resData = await apiJson<{
        user_id: string;
        role: StaffRole;
        scope: StaffScope;
        village_id: string | null;
        village_ids: string[];
        force_password_reset: boolean;
        temporary_password: string;
      }>("/auth/staff-users", {
        method: "POST",
        body: JSON.stringify({
          display_name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          role,
          village_ids: selectedVillageIds,
        })
      });

      setCreatedAccount({
        id: resData.user_id,
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        role: resData.role,
        scope: resData.scope,
        village_id: resData.village_id,
        village_ids: resData.village_ids,
        temporary_password: resData.temporary_password,
      });
      setSuccess(`Đã cấp thành công tài khoản mới cho cán bộ: ${name.trim()}`);
      
      // Refresh list
      void fetchOfficers();

      // Reset form fields
      setName("");
      setEmail("");
      setPhone("");
    } catch (err: any) {
      setError(toUserFacingError(err, "Không thể cấp tài khoản."));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Format last login timestamp nicely
  const formatLastLogin = (timestamp: string | null) => {
    if (!timestamp) {
      return (
        <span className="text-slate-400 font-semibold text-5xs tracking-wider uppercase bg-slate-100 px-2 py-0.5 rounded-full">
          Chưa đăng nhập
        </span>
      );
    }
    const dateObj = new Date(timestamp);
    return (
      <div className="text-xs">
        <span className="font-bold text-slate-700 block">{dateObj.toLocaleDateString("vi-VN")}</span>
        <span className="text-4xs text-slate-400 font-mono block">{dateObj.toLocaleTimeString("vi-VN", { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
    );
  };

  // Filter accounts
  const filteredOfficers = officers.filter((o) => {
    const matchesSearch = 
      o.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (o.email || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (o.phone || "").includes(searchTerm);
    
    const scopedVillageIds = Array.from(
      new Set([...(o.village_ids || []), ...(o.village_id ? [o.village_id] : [])]),
    );
    const matchesVillage =
      selectedVillageFilter === "all" ||
      COMMUNE_WIDE_ROLES.has(o.role) ||
      scopedVillageIds.includes(selectedVillageFilter);
    const matchesRole = selectedRoleFilter === "all" || o.role === selectedRoleFilter;
    const matchesStatus = 
      selectedStatusFilter === "all" || 
      (selectedStatusFilter === "active" && o.is_active) || 
      (selectedStatusFilter === "locked" && !o.is_active);

    return matchesSearch && matchesVillage && matchesRole && matchesStatus;
  });

  return (
    <div id="manage-accounts-container" className="max-w-6xl mx-auto space-y-6">
      
      {/* Upper Information Banner */}
      <div className="bg-emerald-950 text-white rounded-2xl p-6 shadow-md relative overflow-hidden">
        <div aria-hidden="true" className="pointer-events-none absolute -right-12 -bottom-12 opacity-10">
          <Shield className="w-48 h-48" />
        </div>
        <div className="relative z-10 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-5">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-emerald-800 rounded-xl text-emerald-300">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-lg font-black tracking-tight text-white uppercase">Quản lý tài khoản cán bộ</h1>
              <p className="text-2xs font-medium text-emerald-200 mt-1">
                Cấp đúng vai trò và địa bàn cho cán bộ thôn, CNSCĐ, cán bộ xã và lãnh đạo xã. Phạm vi được máy chủ kiểm tra trước khi tạo tài khoản.
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-expanded={showCreateForm}
            aria-controls="account-access-panel"
            onClick={() => {
              setShowCreateForm(!showCreateForm);
              setCreatedAccount(null);
            }}
            className="min-h-14 w-full shrink-0 px-6 py-3 bg-amber-300 hover:bg-amber-200 active:scale-98 text-emerald-950 font-black text-sm uppercase rounded-xl border-2 border-amber-100 shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-2.5 cursor-pointer sm:w-auto"
          >
            {showCreateForm ? <X className="w-5 h-5" /> : <UserPlus className="w-5 h-5" />}
            <span>{showCreateForm ? "Đóng biểu mẫu" : "Cấp tài khoản mới"}</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-100 text-rose-800 p-4 rounded-xl flex items-start gap-2.5 text-xs font-semibold">
          <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="bg-emerald-50 border border-emerald-100 text-emerald-850 p-4 rounded-xl flex items-start gap-2.5 text-xs font-semibold animate-fade-in">
          <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <span>{success}</span>
        </div>
      )}

      <WorkSection
        index="01"
        title="Cấp mới và khôi phục quyền truy cập"
        description="Tách riêng thao tác tạo tài khoản, cấp lại mật khẩu và thông tin bàn giao khỏi danh sách nhân sự đang quản lý."
        tone="tasks"
        icon={<KeyRound />}
      >
        <div id="account-access-panel" className="space-y-4">
          {!showCreateForm && !resetPasswordResult && !createdAccount && (
            <div className="rounded-xl border border-dashed border-emerald-200 bg-white/75 p-5 text-sm text-slate-600">
              Chọn <strong>Cấp tài khoản mới</strong> ở đầu trang để mở biểu mẫu. Kết quả tạo tài khoản hoặc cấp lại mật khẩu sẽ chỉ xuất hiện trong khu vực này.
            </div>
          )}

      {/* Password Reset Result UI */}
      {resetPasswordResult && (
        <div className="bg-amber-50/50 border border-amber-200 rounded-xl p-5 space-y-4 animate-fade-in max-w-2xl mx-auto shadow-sm">
          <div className="flex items-center gap-2.5 text-amber-900 font-extrabold text-xs">
            <CheckCircle className="w-5.5 h-5.5 text-emerald-600 shrink-0" />
            <span>Đã cấp lại mật khẩu thành công!</span>
          </div>

          <div className="bg-white rounded-xl p-4 border border-amber-200 text-xs space-y-3 font-semibold text-slate-700">
            <p className="text-slate-600">Vui lòng sao chép mật khẩu dưới đây và gửi cho cán bộ <b>{resetPasswordResult.name}</b>:</p>
            <div className="flex justify-between items-center py-2 bg-amber-50 px-3 rounded-lg border border-amber-100/50">
              <span className="text-amber-950 font-bold uppercase tracking-wider text-4xs">Mật khẩu mới:</span>
              <b className="text-amber-950 font-black font-mono text-base tracking-widest select-all">{resetPasswordResult.tempPass}</b>
            </div>
            
            <div className="flex gap-1.5 text-4xs text-amber-700 bg-amber-25 p-2 rounded">
              <KeyRound className="w-4 h-4 text-amber-600 shrink-0" />
              <span>Tài khoản sẽ bị <b>bắt buộc đổi mật khẩu</b> ở lần đăng nhập tiếp theo.</span>
            </div>
          </div>
        </div>
      )}

      {/* Account Created Success Details */}
      {createdAccount && (
        <div className="bg-amber-50/50 border border-amber-200 rounded-xl p-5 space-y-4 animate-fade-in max-w-2xl mx-auto shadow-sm">
          <div className="flex items-center gap-2.5 text-amber-900 font-extrabold text-xs">
            <CheckCircle className="w-5.5 h-5.5 text-emerald-600 shrink-0" />
            <span>Đã tạo tài khoản cán bộ thành công.</span>
          </div>

          <div className="bg-white rounded-xl p-4 border border-amber-200 text-xs space-y-3 font-semibold text-slate-700">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="text-4xs text-slate-400 uppercase tracking-wide">Họ tên cán bộ:</span>
                <p className="text-slate-800 font-black">{createdAccount.name}</p>
              </div>
              <div>
                <span className="text-4xs text-slate-400 uppercase tracking-wide">Email đăng nhập:</span>
                <p className="text-slate-800 font-mono">{createdAccount.email}</p>
              </div>
              <div>
                <span className="text-4xs text-slate-400 uppercase tracking-wide">Số điện thoại liên hệ:</span>
                <p className="text-slate-800 font-mono">{createdAccount.phone}</p>
              </div>
              <div>
                <span className="text-4xs text-slate-400 uppercase tracking-wide">Vai trò:</span>
                <p className="text-slate-800 font-black">
                  {ROLE_LABELS[createdAccount.role]}
                </p>
              </div>
              <div className="col-span-2">
                <span className="text-4xs text-slate-400 uppercase tracking-wide">Phạm vi phụ trách:</span>
                <p className="text-slate-800 font-black">
                  {getScopeLabel(createdAccount.role, createdAccount.village_ids)}
                </p>
              </div>
            </div>

            <div className="border-t border-dashed border-slate-150 pt-3 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 bg-amber-50/70 -mx-4 -mb-4 p-4 rounded-b-xl">
              <div>
                <span className="text-4xs text-amber-800 font-black uppercase tracking-wider flex items-center gap-1">
                  <KeyRound className="w-4 h-4 text-amber-700" />
                  Mật khẩu tạm thời cấp cho cán bộ:
                </span>
                <p className="text-4xs text-amber-700 font-medium mt-0.5">Bắt buộc đổi mật khẩu ở lần đăng nhập đầu tiên.</p>
              </div>
              <span className="text-sm font-black font-mono tracking-widest bg-amber-950 text-amber-100 px-4 py-2 rounded-lg select-all border border-amber-800 shadow-3xs">
                {createdAccount.temporary_password}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Slide down / Create New Account Form */}
      {showCreateForm && (
        <div className="bg-white rounded-2xl border border-slate-150 shadow-md overflow-hidden animate-fade-in max-w-2xl mx-auto">
          <div className="bg-emerald-800/10 px-5 py-3.5 border-b border-slate-150 flex justify-between items-center">
            <h3 className="text-xs font-black text-slate-800 flex items-center gap-2 uppercase tracking-wide">
              <UserPlus className="w-4.5 h-4.5 text-emerald-800" />
              <span>Khởi tạo tài khoản nhân sự mới</span>
            </h3>
            <button 
              type="button" 
              onClick={() => setShowCreateForm(false)} 
              aria-label="Đóng biểu mẫu tạo tài khoản"
              className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleCreateAccountSubmit} className="p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              
              {/* Officer Full Name */}
              <div className="space-y-1">
                <label className="block text-4xs font-extrabold text-slate-500 uppercase tracking-wider">Họ và Tên Cán bộ:</label>
                <input
                  type="text"
                  required
                  placeholder="vd: Nguyễn Văn A"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={isSubmitting}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-xs font-semibold text-slate-800 focus:outline-hidden focus:border-emerald-600 focus:bg-white transition-all"
                />
              </div>

              {/* Email Address */}
              <div className="space-y-1">
                <label className="block text-4xs font-extrabold text-slate-500 uppercase tracking-wider">Email định danh:</label>
                <input
                  type="email"
                  required
                  placeholder="vd: canbo.tanlang@bana.gov.vn"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isSubmitting}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-xs font-mono font-semibold text-slate-800 focus:outline-hidden focus:border-emerald-600 focus:bg-white transition-all"
                />
              </div>

              {/* Contact phone number */}
              <div className="space-y-1">
                <label className="block text-4xs font-extrabold text-slate-500 uppercase tracking-wider">Số điện thoại liên hệ:</label>
                <input
                  type="text"
                  required
                  placeholder="vd: 0905123456"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  disabled={isSubmitting}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-xs font-mono font-semibold text-slate-800 focus:outline-hidden focus:border-emerald-600 focus:bg-white transition-all"
                />
              </div>

              {/* Role */}
              <div className="space-y-1">
                <label htmlFor="new-account-role" className="block text-4xs font-extrabold text-slate-500 uppercase tracking-wider">Phân quyền chức vụ:</label>
                <select
                  id="new-account-role"
                  value={role}
                  onChange={(e) => handleRoleChange(e.target.value as StaffRole)}
                  disabled={isSubmitting}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-xs font-semibold text-slate-700 focus:outline-hidden focus:border-emerald-600 focus:bg-white transition-all"
                >
                  <option value="can_bo_thon">Cán bộ Thôn</option>
                  <option value="to_cnscd">Thành viên Tổ công nghệ số cộng đồng</option>
                  <option value="admin_xa">Cán bộ xã</option>
                  <option value="lanh_dao">Lãnh đạo xã</option>
                </select>
              </div>

              {/* Managed Village */}
              <div className="space-y-1 sm:col-span-2">
                <label className="block text-4xs font-extrabold text-slate-500 uppercase tracking-wider">Thôn phụ trách / Địa bàn quản lý:</label>
                {role === "can_bo_thon" && (
                  <>
                    <select
                      aria-label="Thôn duy nhất cán bộ thôn phụ trách"
                      value={selectedVillageIds[0] || ""}
                      onChange={(e) => setSelectedVillageIds(e.target.value ? [e.target.value] : [])}
                      disabled={isSubmitting}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-3 text-xs font-semibold text-slate-700 focus:outline-hidden focus:border-emerald-600 focus:bg-white transition-all"
                    >
                      {new_villages.map((v) => (
                        <option key={v.id} value={v.id}>{v.name}</option>
                      ))}
                    </select>
                    <p className="text-5xs font-semibold text-slate-500">
                      Cán bộ thôn chỉ được phụ trách đúng 1 thôn.
                    </p>
                  </>
                )}

                {role === "to_cnscd" && (
                  <fieldset className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <legend className="text-xs font-bold text-slate-700">
                        Chọn một hoặc nhiều thôn được giao
                      </legend>
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedVillageIds(
                            selectedVillageIds.length === new_villages.length
                              ? []
                              : new_villages.map((village) => village.id),
                          )
                        }
                        disabled={isSubmitting || new_villages.length === 0}
                        className="rounded-lg border border-emerald-200 bg-white px-2.5 py-1 text-5xs font-black text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
                      >
                        {selectedVillageIds.length === new_villages.length
                          ? "Bỏ chọn tất cả"
                          : "Chọn tất cả"}
                      </button>
                    </div>
                    <div className="grid max-h-44 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                      {new_villages.map((village) => (
                        <label
                          key={village.id}
                          className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-emerald-300"
                        >
                          <input
                            type="checkbox"
                            checked={selectedVillageIds.includes(village.id)}
                            onChange={(event) =>
                              setSelectedVillageIds((current) =>
                                event.target.checked
                                  ? Array.from(new Set([...current, village.id]))
                                  : current.filter((villageId) => villageId !== village.id),
                              )
                            }
                            disabled={isSubmitting}
                            className="h-4 w-4 accent-emerald-700"
                          />
                          <span>{village.name}</span>
                        </label>
                      ))}
                    </div>
                    <p className="mt-3 text-5xs font-bold text-emerald-800">
                      Đã chọn {selectedVillageIds.length}/{new_villages.length} thôn
                    </p>
                  </fieldset>
                )}

                {COMMUNE_WIDE_ROLES.has(role) && (
                  <div
                    role="status"
                    className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-950"
                  >
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                    <div>
                      <p className="font-black">Phạm vi toàn xã được gán tự động</p>
                      <p className="mt-0.5 font-medium text-emerald-800">
                        {ROLE_LABELS[role]} được xem và làm việc trên toàn bộ {new_villages.length} thôn; không cần chọn từng thôn.
                      </p>
                    </div>
                  </div>
                )}
              </div>

            </div>

            <div className="pt-3 border-t border-slate-100 flex justify-end">
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-5 py-2.5 bg-emerald-950 hover:bg-emerald-800 active:scale-98 text-white font-black text-2xs uppercase rounded-xl transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin text-white/80" />
                    <span>ĐANG ĐĂNG KÝ...</span>
                  </>
                ) : (
                  <>
                    <UserPlus className="w-4 h-4" />
                    <span>TẠO TÀI KHOẢN VÀ MẬT KHẨU TẠM</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}
        </div>
      </WorkSection>

      {/* Accounts List and Search/Filters Panel */}
      <WorkSection
        index="02"
        title="Lọc và quản lý tài khoản hiện có"
        description="Tìm theo nhân sự, địa bàn, vai trò hoặc trạng thái; mỗi thẻ tài khoản giữ riêng thông tin và hành động quản trị."
        tone="evidence"
        icon={<Users />}
      >
        <div className="bg-white rounded-2xl border border-slate-150 shadow-md overflow-hidden">
        
        {/* Table Filters Header */}
        <div className="p-5 border-b border-slate-150 bg-slate-25/50 space-y-4">
          <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
            <h3 className="text-xs font-black text-slate-800 flex items-center gap-2 uppercase tracking-wide shrink-0">
              <Users className="w-5 h-5 text-emerald-950" />
              <span>
                Danh sách tài khoản cán bộ (
                {isLoading ? "đang tải" : `${filteredOfficers.length} thành viên`}
                )
              </span>
            </h3>

            {/* Quick search input */}
            <div className="relative w-full md:max-w-xs">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                <Search className="w-4 h-4" />
              </span>
              <input
                type="text"
                aria-label="Tìm kiếm tài khoản cán bộ"
                placeholder="Tìm kiếm họ tên, email, số điện thoại…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-xl py-1.5 pl-9 pr-3 text-2xs font-semibold text-slate-800 focus:outline-hidden focus:border-emerald-650 focus:ring-1 focus:ring-indigo-200 transition-all placeholder:font-normal placeholder:text-slate-400"
              />
            </div>
          </div>

          {/* Quick Dropdown Filters */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-5xs font-black text-slate-400 uppercase tracking-wider mb-1">Theo địa bàn (Thôn):</label>
              <select
                value={selectedVillageFilter}
                onChange={(e) => setSelectedVillageFilter(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg py-1 px-2 text-2xs font-semibold text-slate-650 focus:outline-hidden focus:ring-1 focus:ring-emerald-100"
              >
                <option value="all">Tất cả các địa bàn</option>
                {new_villages.map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-5xs font-black text-slate-400 uppercase tracking-wider mb-1">Theo vai trò:</label>
              <select
                value={selectedRoleFilter}
                onChange={(e) => setSelectedRoleFilter(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg py-1 px-2 text-2xs font-semibold text-slate-650 focus:outline-hidden focus:ring-1 focus:ring-emerald-100"
              >
                <option value="all">Tất cả vai trò</option>
                <option value="can_bo_thon">Cán bộ Thôn</option>
                <option value="to_cnscd">Thành viên Tổ công nghệ số cộng đồng</option>
                <option value="admin_xa">Cán bộ xã</option>
                <option value="lanh_dao">Lãnh đạo xã</option>
              </select>
            </div>

            <div>
              <label className="block text-5xs font-black text-slate-400 uppercase tracking-wider mb-1">Theo trạng thái:</label>
              <select
                value={selectedStatusFilter}
                onChange={(e) => setSelectedStatusFilter(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg py-1 px-2 text-2xs font-semibold text-slate-650 focus:outline-hidden focus:ring-1 focus:ring-emerald-100"
              >
                <option value="all">Tất cả trạng thái</option>
                <option value="active">Đang hoạt động</option>
                <option value="locked">Đã khóa</option>
              </select>
            </div>
          </div>
        </div>

        {/* Officers Data Table */}
        {isLoading ? (
          <div className="p-12 text-center text-slate-500 font-semibold text-2xs space-y-2">
            <RefreshCw className="w-8 h-8 animate-spin text-emerald-800 mx-auto" />
            <p>Đang đồng bộ danh sách tài khoản từ máy chủ...</p>
          </div>
        ) : loadError ? (
          <div className="p-5">
            <ErrorState
              description={loadError}
              onRetry={() => void fetchOfficers()}
            />
          </div>
        ) : filteredOfficers.length === 0 ? (
          <div className="p-12 text-center text-slate-400 font-medium text-2xs space-y-1">
            <Users className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <p>Không tìm thấy tài khoản cán bộ nào khớp với bộ lọc.</p>
          </div>
        ) : (
          <div className="grid gap-4 p-4 xl:grid-cols-2">
            {filteredOfficers.map((officer) => {
              const officerVillageIds = Array.from(
                new Set([
                  ...(officer.village_ids || []),
                  ...(officer.village_id ? [officer.village_id] : []),
                ]),
              );
              const roleLabel = ROLE_LABELS[officer.role];
              const scopeLabel = getScopeLabel(officer.role, officerVillageIds);
              const hasVillageLevelActions = !COMMUNE_WIDE_ROLES.has(officer.role);
              return (
                <article
                  key={officer.id}
                  className={`rounded-xl border p-4 shadow-2xs ${
                    officer.is_active
                      ? "border-slate-200 bg-white"
                      : "border-rose-200 bg-rose-50/30"
                  }`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <h4 className="text-sm font-extrabold text-slate-900">
                        {officer.name}
                      </h4>
                      <div className="mt-2 space-y-1 text-xs text-slate-600">
                        <div className="flex min-w-0 items-center gap-2">
                          <Mail className="h-4 w-4 shrink-0 text-slate-400" />
                          <span className="min-w-0 break-all">{officer.email || "Chưa cập nhật email"}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Phone className="h-4 w-4 shrink-0 text-slate-400" />
                          <span>{officer.phone || "Chưa cập nhật số điện thoại"}</span>
                        </div>
                      </div>
                    </div>
                    <span
                      className={`inline-flex w-fit items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-bold ${
                        officer.is_active
                          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                          : "border-rose-200 bg-rose-50 text-rose-800"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          officer.is_active ? "bg-emerald-600" : "bg-rose-600"
                        }`}
                      />
                      {officer.is_active ? "Đang hoạt động" : "Đã khóa"}
                    </span>
                  </div>

                  <dl className="mt-4 grid gap-3 rounded-lg bg-slate-50 p-3 text-xs sm:grid-cols-3">
                    <div>
                      <dt className="font-bold text-slate-500">Vai trò</dt>
                      <dd className="mt-1 flex items-start gap-1.5 font-semibold text-slate-800">
                        <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700" />
                        {roleLabel}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-bold text-slate-500">Địa bàn</dt>
                      <dd className="mt-1 flex items-center gap-1.5 font-semibold text-slate-800">
                        <MapPin className="h-3.5 w-3.5 shrink-0 text-emerald-700" />
                        {scopeLabel}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-bold text-slate-500">Đăng nhập gần nhất</dt>
                      <dd className="mt-1">{formatLastLogin(officer.last_login)}</dd>
                    </div>
                  </dl>

                  {hasVillageLevelActions ? (
                    <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
                      <button
                        type="button"
                        onClick={() =>
                          handleResetPassword(officer.id, officer.name)
                        }
                        className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-3 text-xs font-bold text-sky-800 transition-colors hover:bg-sky-100"
                      >
                        <KeyRound className="h-4 w-4" />
                        Cấp lại mật khẩu
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          handleToggleStatus(
                            officer.id,
                            officer.name,
                            officer.is_active,
                          )
                        }
                        className={`inline-flex min-h-10 items-center gap-1.5 rounded-lg border px-3 text-xs font-bold transition-colors ${
                          officer.is_active
                            ? "border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100"
                            : "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                        }`}
                      >
                        {officer.is_active ? (
                          <Lock className="h-4 w-4" />
                        ) : (
                          <Unlock className="h-4 w-4" />
                        )}
                        {officer.is_active ? "Khóa tài khoản" : "Mở khóa tài khoản"}
                      </button>
                    </div>
                  ) : (
                    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-5xs font-semibold text-amber-900">
                      Tài khoản cấp xã có quyền rộng; việc khóa hoặc cấp lại mật khẩu được xử lý theo quy trình quản trị đặc quyền.
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}

        </div>
      </WorkSection>

    </div>
  );
}
