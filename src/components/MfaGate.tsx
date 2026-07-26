import { useEffect, useState } from "react";
import { KeyRound, Loader2, LogOut, QrCode, ShieldCheck } from "lucide-react";
import { supabase } from "../lib/supabase";
import type { MfaStatus } from "../lib/AuthContext";

interface MfaGateProps {
  status: MfaStatus;
  factorId: string | null;
  onRefresh: () => Promise<void>;
  onLogout: () => Promise<void>;
}

interface Enrollment {
  factorId: string;
  qrCode: string;
  secret: string;
}

export default function MfaGate({ status, factorId, onRefresh, onLogout }: MfaGateProps) {
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setCode("");
    setError(null);
    if (status !== "setup_required") setEnrollment(null);
  }, [status]);

  const beginEnrollment = async () => {
    setBusy(true);
    setError(null);
    try {
      const factors = await supabase.auth.mfa.listFactors();
      if (factors.error) throw factors.error;

      const verifiedFactor = factors.data.totp.find((factor) => factor.status === "verified");
      if (verifiedFactor) {
        await onRefresh();
        return;
      }

      // A setup interrupted before verification leaves an unverified factor in
      // Supabase. Remove it before enrolling again so retries do not conflict.
      for (const factor of factors.data.all.filter(
        (item) => item.factor_type === "totp" && item.status === "unverified",
      )) {
        const removed = await supabase.auth.mfa.unenroll({ factorId: factor.id });
        if (removed.error) throw removed.error;
      }

      const result = await supabase.auth.mfa.enroll({
        factorType: "totp",
      });
      if (result.error) throw result.error;
      setEnrollment({
        factorId: result.data.id,
        qrCode: result.data.totp.qr_code,
        secret: result.data.totp.secret,
      });
    } catch {
      setError("Không thể tạo mã bảo mật. Vui lòng thử lại hoặc liên hệ quản trị hệ thống.");
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    const targetFactorId = enrollment?.factorId || factorId;
    if (!targetFactorId || !/^\d{6}$/.test(code)) {
      setError("Nhập đúng 6 chữ số đang hiển thị trong ứng dụng xác thực.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await supabase.auth.mfa.challengeAndVerify({
        factorId: targetFactorId,
        code,
      });
      if (result.error) throw result.error;
      await onRefresh();
    } catch {
      setError("Mã bảo mật không hợp lệ hoặc đã hết thời gian. Vui lòng dùng mã mới nhất.");
    } finally {
      setBusy(false);
    }
  };

  const checking = status === "checking";
  const unavailable = status === "unavailable";
  const needsSetup = status === "setup_required";

  return (
    <main className="min-h-screen bg-emerald-950 flex items-center justify-center p-4">
      <section className="w-full max-w-lg rounded-2xl bg-white p-6 sm:p-8 shadow-2xl" aria-busy={busy || checking}>
        <div className="flex items-start gap-4">
          <span className="rounded-xl bg-emerald-50 p-3 text-emerald-800">
            <ShieldCheck className="h-7 w-7" aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-800">Bảo vệ tài khoản nội bộ</p>
            <h1 className="mt-1 text-2xl font-bold text-slate-950">Xác thực hai lớp</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Tài khoản quản trị và lãnh đạo phải xác nhận thêm mã dùng một lần trước khi truy cập dữ liệu.
            </p>
          </div>
        </div>

        {error && <p role="alert" className="mt-5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800">{error}</p>}

        {checking && (
          <div className="mt-7 flex items-center justify-center gap-3 rounded-xl bg-slate-50 p-6 text-sm font-semibold text-slate-700">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Đang kiểm tra mức bảo vệ…
          </div>
        )}

        {unavailable && (
          <div className="mt-6 space-y-4">
            <p className="rounded-xl bg-amber-50 p-4 text-sm leading-6 text-amber-950">
              Dịch vụ xác thực hai lớp đang tạm thời không sẵn sàng. Hệ thống không mở quyền nội bộ khi chưa xác minh được.
            </p>
            <button type="button" className="button button--primary w-full" onClick={() => void onRefresh()} disabled={busy}>Thử kiểm tra lại</button>
          </div>
        )}

        {needsSetup && !enrollment && (
          <div className="mt-6 space-y-4">
            <div className="rounded-xl border border-slate-200 p-4">
              <h2 className="flex items-center gap-2 font-bold text-slate-900"><QrCode className="h-5 w-5" /> Thiết lập lần đầu</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">Dùng ứng dụng xác thực trên điện thoại như Microsoft Authenticator, Google Authenticator hoặc ứng dụng TOTP tương đương.</p>
            </div>
            <button type="button" className="button button--primary w-full" onClick={() => void beginEnrollment()} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />} Tạo mã QR bảo mật
            </button>
          </div>
        )}

        {enrollment && (
          <div className="mt-6 space-y-4">
            <div className="mx-auto w-fit rounded-xl border border-slate-200 bg-white p-3">
              <img src={enrollment.qrCode} alt="Mã QR để thêm Ba Na SmartLink vào ứng dụng xác thực" className="h-52 w-52" />
            </div>
            <p className="text-center text-sm text-slate-600">Quét mã QR. Nếu không quét được, nhập khóa sau:</p>
            <p className="break-all rounded-lg bg-slate-100 p-3 text-center font-mono text-sm font-bold text-slate-900">{enrollment.secret}</p>
          </div>
        )}

        {!checking && !unavailable && (enrollment || status === "challenge_required") && (
          <div className="mt-6 space-y-3">
            <label htmlFor="mfa-code" className="block text-sm font-semibold text-slate-800">Mã bảo mật 6 chữ số</label>
            <div className="relative">
              <KeyRound className="absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" aria-hidden="true" />
              <input id="mfa-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} className="w-full pl-11! text-lg tracking-[0.3em]" />
            </div>
            <button type="button" className="button button--primary w-full" onClick={() => void verify()} disabled={busy || code.length !== 6}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Xác nhận và tiếp tục
            </button>
          </div>
        )}

        <button type="button" onClick={() => void onLogout()} className="mt-6 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
          <LogOut className="h-4 w-4" aria-hidden="true" /> Đăng xuất
        </button>
      </section>
    </main>
  );
}
