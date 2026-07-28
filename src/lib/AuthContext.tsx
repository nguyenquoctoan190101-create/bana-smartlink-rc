import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, isAuthConfigured } from "./supabase";
import { apiJson } from "./apiClient";
import { resolveStaffLoginEmail } from "./loginIdentifier";
import { clearOfflineData, setOfflineOwner } from "./db";
import type { AuthProfile, UserRole } from "../types";
import { resolveRoleVillageIds } from "./rolePresentation";

interface AuthContextType {
  userId: string | null;
  isLoggedIn: boolean;
  userRole: UserRole;
  userVillageId: string | null;
  userVillageIds: string[];
  userName: string | null;
  userPhone: string | null;
  loginPhone: string;
  loginPassword: string;
  loginError: string | null;
  publicMode: "public" | "login";
  isAuthLoading: boolean;
  isLoginSubmitting: boolean;
  requiresPasswordReset: boolean;
  mfaStatus: MfaStatus;
  mfaFactorId: string | null;
  setLoginPhone: (phone: string) => void;
  setLoginPassword: (password: string) => void;
  setLoginError: (error: string | null) => void;
  setPublicMode: (mode: "public" | "login") => void;
  handleLoginSubmit: (event: React.FormEvent) => Promise<void>;
  handlePasswordChange: (newPassword: string) => Promise<void>;
  refreshMfaStatus: () => Promise<void>;
  handleLogout: () => Promise<void>;
  getUserId: () => string;
}

export type MfaStatus =
  | "not_required"
  | "checking"
  | "setup_required"
  | "challenge_required"
  | "verified"
  | "unavailable";

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const PUBLIC_STATE = {
  userId: null,
  userRole: "dan" as UserRole,
  userVillageId: null,
  userVillageIds: [] as string[],
  userName: "Người dân",
  userPhone: null,
};

interface IdentityState {
  userId: string | null;
  userRole: UserRole;
  userName: string | null;
  userPhone: string | null;
  userVillageId: string | null;
  userVillageIds: string[];
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [identity, setIdentity] = useState<IdentityState>(PUBLIC_STATE);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [requiresPasswordReset, setRequiresPasswordReset] = useState(false);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaStatus, setMfaStatus] = useState<MfaStatus>("not_required");
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [loginPhone, setLoginPhone] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [publicMode, setPublicMode] = useState<"public" | "login">("public");
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isLoginSubmitting, setIsLoginSubmitting] = useState(false);

  const resetIdentity = useCallback(() => {
    setIdentity(PUBLIC_STATE);
    setIsLoggedIn(false);
    setRequiresPasswordReset(false);
    setMfaRequired(false);
    setMfaStatus("not_required");
    setMfaFactorId(null);
    setOfflineOwner(null, null);
  }, []);

  const assessMfa = useCallback(async (required: boolean) => {
    setMfaRequired(required);
    setMfaFactorId(null);
    if (!required) {
      setMfaStatus("not_required");
      return;
    }
    setMfaStatus("checking");
    try {
      const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assurance.error) throw assurance.error;
      if (assurance.data.currentLevel === "aal2") {
        setMfaStatus("verified");
        return;
      }
      const factors = await supabase.auth.mfa.listFactors();
      if (factors.error) throw factors.error;
      const verifiedTotp = factors.data.totp.find((factor) => factor.status === "verified");
      if (verifiedTotp) {
        setMfaFactorId(verifiedTotp.id);
        setMfaStatus("challenge_required");
      } else {
        setMfaStatus("setup_required");
      }
    } catch {
      setMfaStatus("unavailable");
    }
  }, []);

  const loadProfile = useCallback(async (session: Session): Promise<boolean> => {
    try {
      const profile = await apiJson<AuthProfile>("/auth/me");
      if (!profile.is_active) {
        await supabase.auth.signOut();
        resetIdentity();
        setLoginError("Tài khoản đã bị khóa. Vui lòng liên hệ quản trị xã.");
        return false;
      }
      setIdentity({
        userId: profile.id || session.user.id,
        userRole: profile.role,
        userVillageId: profile.village_id,
        userVillageIds: resolveRoleVillageIds(
          profile.role,
          profile.village_id,
          profile.assigned_village_ids,
        ),
        userName: profile.display_name || session.user.email || "Cán bộ",
        userPhone: profile.phone,
      });
      setOfflineOwner(profile.id || session.user.id, profile.village_id);
      setRequiresPasswordReset(Boolean(profile.force_password_reset));
      setIsLoggedIn(true);
      await assessMfa(Boolean(profile.mfa_required));
      return true;
    } catch {
      await supabase.auth.signOut();
      resetIdentity();
      setLoginError("Không xác minh được hồ sơ và quyền truy cập. Vui lòng đăng nhập lại.");
      return false;
    }
  }, [assessMfa, resetIdentity]);

  useEffect(() => {
    let mounted = true;
    const initialize = async () => {
      if (!isAuthConfigured) {
        if (mounted) setIsAuthLoading(false);
        return;
      }
      const { data, error } = await supabase.auth.getSession();
      if (!mounted) return;
      if (error || !data.session) {
        resetIdentity();
        setIsAuthLoading(false);
        return;
      }
      await loadProfile(data.session);
      if (mounted) setIsAuthLoading(false);
    };
    void initialize();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted || event === "INITIAL_SESSION") return;
      if (!session || event === "SIGNED_OUT") {
        resetIdentity();
        return;
      }
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        void loadProfile(session);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [loadProfile, resetIdentity]);

  const handleLoginSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isLoginSubmitting) return;
    setLoginError(null);
    if (!isAuthConfigured) {
      setLoginError("Đăng nhập cán bộ chưa được cấu hình trên môi trường này.");
      return;
    }
    setIsLoginSubmitting(true);
    try {
      const email = resolveStaffLoginEmail(loginPhone);
      if (!email) {
        setLoginError("Vui lòng nhập đúng số điện thoại hoặc địa chỉ email.");
        return;
      }
      const { data, error } = await supabase.auth.signInWithPassword({ email, password: loginPassword });
      if (error || !data.session) {
        setLoginError("Số điện thoại, email hoặc mật khẩu không chính xác.");
        return;
      }
      const loaded = await loadProfile(data.session);
      if (loaded) {
        setLoginPhone("");
        setLoginPassword("");
      }
    } catch {
      setLoginError("Không thể kết nối dịch vụ đăng nhập. Vui lòng thử lại.");
    } finally {
      setIsLoginSubmitting(false);
    }
  };

  const handlePasswordChange = async (newPassword: string) => {
    if (newPassword.length < 12) throw new Error("Mật khẩu mới phải có ít nhất 12 ký tự.");
    await apiJson<void>("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ new_password: newPassword }),
    });
    setRequiresPasswordReset(false);
  };

  const refreshMfaStatus = useCallback(async () => {
    await assessMfa(mfaRequired);
  }, [assessMfa, mfaRequired]);

  const handleLogout = async () => {
    // Clear only the current user's local partition; never erase unrelated
    // browser data or another officer's queue.
    try { await clearOfflineData(); } catch { /* best effort */ }
    await supabase.auth.signOut();
    resetIdentity();
  };

  const value = useMemo<AuthContextType>(() => ({
    ...identity,
    isLoggedIn,
    loginPhone,
    loginPassword,
    loginError,
    publicMode,
    isAuthLoading,
    isLoginSubmitting,
    requiresPasswordReset,
    mfaStatus,
    mfaFactorId,
    setLoginPhone,
    setLoginPassword,
    setLoginError,
    setPublicMode,
    handleLoginSubmit,
    handlePasswordChange,
    refreshMfaStatus,
    handleLogout,
    getUserId: () => identity.userId || "guest",
  }), [identity, isLoggedIn, loginPhone, loginPassword, loginError, publicMode, isAuthLoading, isLoginSubmitting, requiresPasswordReset, mfaStatus, mfaFactorId, refreshMfaStatus]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}
