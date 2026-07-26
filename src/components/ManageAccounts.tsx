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

interface Officer {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: "can_bo_thon" | "to_cnscd";
  village_id: string;
  is_active: boolean;
  last_login: string | null;
}

export default function ManageAccounts() {
  const { villages: new_villages } = useVillages();
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [resetPasswordResult, setResetPasswordResult] = useState<{name: string, tempPass: string} | null>(null);

  // Form states for creating new account
  const [showCreateForm, setShowCreateForm] = useState<boolean>(false);
  const [name, setName] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [phone, setPhone] = useState<string>("");
  const [role, setRole] = useState<"can_bo_thon" | "to_cnscd">("can_bo_thon");
  const [villageId, setVillageId] = useState<string>(new_villages[0]?.id || "");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [createdAccount, setCreatedAccount] = useState<any | null>(null);

  // Filter and Search states
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [selectedVillageFilter, setSelectedVillageFilter] = useState<string>("all");
  const [selectedRoleFilter, setSelectedRoleFilter] = useState<string>("all");
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>("all");

  useEffect(() => {
    if (!villageId && new_villages.length > 0) setVillageId(new_villages[0].id);
  }, [new_villages, villageId]);

  // Fetch all accounts
  const fetchOfficers = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const resData = await apiJson<Officer[]>("/auth/officers");
      setOfficers(Array.isArray(resData) ? resData : []);
    } catch (err: any) {
      setError(toUserFacingError(err, "Không thể tải danh sách tài khoản."));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchOfficers();
  }, []);

  // Toggle is_active status (Lock/Unlock)
  const handleToggleStatus = async (id: string, currentName: string, isCurrentlyActive: boolean) => {
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

    setIsSubmitting(true);

    try {
      const resData = await apiJson<{ user_id: string; role: Officer["role"]; village_id: string; force_password_reset: boolean; temporary_password: string }>("/auth/staff-users", {
        method: "POST",
        body: JSON.stringify({
          display_name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          role,
          village_id: villageId
        })
      });

      setCreatedAccount({
        id: resData.user_id,
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        role: resData.role,
        village_id: resData.village_id,
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
      o.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      o.phone.includes(searchTerm);
    
    const matchesVillage = selectedVillageFilter === "all" || o.village_id === selectedVillageFilter;
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
        <div className="absolute -right-12 -bottom-12 opacity-10">
          <Shield className="w-48 h-48" />
        </div>
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-emerald-800 rounded-xl text-emerald-300">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-lg font-black tracking-tight text-white uppercase">Quản lý tài khoản cán bộ</h1>
              <p className="text-2xs font-medium text-emerald-200 mt-1">
                Quản lý quyền truy cập của cán bộ thôn và Tổ công nghệ số cộng đồng. Khóa tài khoản nhân sự cũ nhưng vẫn giữ nguyên nhật ký kiểm toán lịch sử.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setShowCreateForm(!showCreateForm);
              setCreatedAccount(null);
            }}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:scale-98 text-white font-black text-2xs uppercase rounded-xl shadow-xs hover:shadow-sm transition-all flex items-center gap-2 cursor-pointer"
          >
            {showCreateForm ? <X className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
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
                <span className="text-4xs text-slate-400 uppercase tracking-wide">Thôn quản lý:</span>
                <p className="text-slate-800 font-black">
                  {new_villages.find((v) => v.id === createdAccount.village_id)?.name || createdAccount.village_id}
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
                <label className="block text-4xs font-extrabold text-slate-500 uppercase tracking-wider">Phân quyền chức vụ:</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as any)}
                  disabled={isSubmitting}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-xs font-semibold text-slate-700 focus:outline-hidden focus:border-emerald-600 focus:bg-white transition-all"
                >
                  <option value="can_bo_thon">Cán bộ Thôn</option>
                  <option value="to_cnscd">Thành viên Tổ công nghệ số cộng đồng</option>
                </select>
              </div>

              {/* Managed Village */}
              <div className="space-y-1 sm:col-span-2">
                <label className="block text-4xs font-extrabold text-slate-500 uppercase tracking-wider">Thôn phụ trách / Địa bàn quản lý:</label>
                <select
                  value={villageId}
                  onChange={(e) => setVillageId(e.target.value)}
                  disabled={isSubmitting}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 px-3 text-xs font-semibold text-slate-700 focus:outline-hidden focus:border-emerald-600 focus:bg-white transition-all"
                >
                  {new_villages.map((v) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
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

      {/* Accounts List and Search/Filters Panel */}
      <div className="bg-white rounded-2xl border border-slate-150 shadow-md overflow-hidden">
        
        {/* Table Filters Header */}
        <div className="p-5 border-b border-slate-150 bg-slate-25/50 space-y-4">
          <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
            <h3 className="text-xs font-black text-slate-800 flex items-center gap-2 uppercase tracking-wide shrink-0">
              <Users className="w-5 h-5 text-emerald-950" />
              <span>Danh sách tài khoản cán bộ ({filteredOfficers.length} thành viên)</span>
            </h3>

            {/* Quick search input */}
            <div className="relative w-full md:max-w-xs">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                <Search className="w-4 h-4" />
              </span>
              <input
                type="text"
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
        ) : filteredOfficers.length === 0 ? (
          <div className="p-12 text-center text-slate-400 font-medium text-2xs space-y-1">
            <Users className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <p>Không tìm thấy tài khoản cán bộ nào khớp với bộ lọc.</p>
          </div>
        ) : (
          <div className="grid gap-4 p-4 xl:grid-cols-2">
            {filteredOfficers.map((officer) => {
              const village = new_villages.find(
                (item) => item.id === officer.village_id,
              );
              const roleLabel =
                officer.role === "can_bo_thon"
                  ? "Cán bộ thôn"
                  : "Tổ công nghệ số cộng đồng";
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
                          <span className="min-w-0 break-all">{officer.email}</span>
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
                        {village?.name || "Toàn xã"}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-bold text-slate-500">Đăng nhập gần nhất</dt>
                      <dd className="mt-1">{formatLastLogin(officer.last_login)}</dd>
                    </div>
                  </dl>

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
                </article>
              );
            })}
          </div>
        )}

      </div>

    </div>
  );
}
