import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, isAuthConfigured } from "./supabase";
import { apiJson } from "./apiClient";
import { clearOfflineData, setOfflineOwner } from "./db";
import type { AuthProfile, UserRole } from "../types";

interface AuthContextType {
  userId: string | null;
  isLoggedIn: boolean;
  userRole: UserRole;
  userVillageId: string | null;
  userName: string | null;
  userPhone: string | null;
  loginPhone: string;
  loginPassword: string;
  loginError: string | null;
  publicMode: "public" | "login";
  isAuthLoading: boolean;
  requiresPasswordReset: boolean;
  setLoginPhone: (phone: string) => void;
  setLoginPassword: (password: string) => void;
  setLoginError: (error: string | null) => void;
  setPublicMode: (mode: "public" | "login") => void;
  handleLoginSubmit: (event: React.FormEvent) => Promise<void>;
  handlePasswordChange: (newPassword: string) => Promise<void>;
  handleLogout: () => Promise<void>;
  getUserId: () => string;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const PUBLIC_STATE = {
  userId: null,
  userRole: "dan" as UserRole,
  userVillageId: null,
  userName: "Người dân",
  userPhone: null,
};

interface IdentityState {
  userId: string | null;
  userRole: UserRole;
  userName: string | null;
  userPhone: string | null;
  userVillageId: string | null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [identity, setIdentity] = useState<IdentityState>(PUBLIC_STATE);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [requiresPasswordReset, setRequiresPasswordReset] = useState(false);
  const [loginPhone, setLoginPhone] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [publicMode, setPublicMode] = useState<"public" | "login">("public");
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  const resetIdentity = useCallback(() => {
    setIdentity(PUBLIC_STATE);
    setIsLoggedIn(false);
    setRequiresPasswordReset(false);
    setOfflineOwner(null, null);
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
        userName: profile.display_name || session.user.email || "Cán bộ",
        userPhone: profile.phone,
      });
      setOfflineOwner(profile.id || session.user.id, profile.village_id);
      setRequiresPasswordReset(Boolean(profile.force_password_reset));
      setIsLoggedIn(true);
      return true;
    } catch {
      await supabase.auth.signOut();
      resetIdentity();
      setLoginError("Không xác minh được hồ sơ và quyền truy cập. Vui lòng đăng nhập lại.");
      return false;
    }
  }, [resetIdentity]);

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
    setLoginError(null);
    if (!isAuthConfigured) {
      setLoginError("Đăng nhập cán bộ chưa được cấu hình trên môi trường này.");
      return;
    }
    const identifier = loginPhone.trim();
    const email = identifier.includes("@") ? identifier : `${identifier}@bana.local`;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password: loginPassword });
    if (error || !data.session) {
      setLoginError("Số điện thoại/email hoặc mật khẩu không chính xác.");
      return;
    }
    const loaded = await loadProfile(data.session);
    if (loaded) {
      setLoginPhone("");
      setLoginPassword("");
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
    requiresPasswordReset,
    setLoginPhone,
    setLoginPassword,
    setLoginError,
    setPublicMode,
    handleLoginSubmit,
    handlePasswordChange,
    handleLogout,
    getUserId: () => identity.userId || "guest",
  }), [identity, isLoggedIn, loginPhone, loginPassword, loginError, publicMode, isAuthLoading, requiresPasswordReset]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}
