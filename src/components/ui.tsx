import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  CircleAlert,
  Inbox,
  RotateCw,
  Search,
  UserCheck,
  Wrench,
  XCircle,
} from "lucide-react";

export function Wordmark({ compact = false, inverse = false }: { compact?: boolean; inverse?: boolean }) {
  return (
    <div className="brand-wordmark" data-inverse={inverse || undefined}>
      <span className="brand-wordmark__mark" aria-hidden="true">BN</span>
      <span className="brand-wordmark__copy">
        <strong>Bà Nà SmartLink</strong>
        {!compact && <small>Hệ thống điều hành dữ liệu cấp xã</small>}
      </span>
    </div>
  );
}

export function TopographicPattern({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={`topographic-pattern ${className}`} viewBox="0 0 640 360" fill="none">
      <path d="M-10 266C72 176 144 182 205 226s113 45 173-9 142-82 274-5" />
      <path d="M-20 300c83-93 166-101 236-53s117 54 187 2 145-67 254-12" />
      <path d="M-16 226c76-77 146-70 196-33s108 42 160-12 151-111 308-25" />
      <path d="M57 146c45-59 108-70 157-31s85 45 125 4 106-76 188-42" />
      <path d="M122 94c34-39 72-45 110-17s67 32 100 2 78-47 137-23" />
      <circle cx="338" cy="181" r="22" />
      <circle cx="338" cy="181" r="44" />
      <circle cx="338" cy="181" r="66" />
    </svg>
  );
}

export function SectionCard({ children, className = "", ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={`ui-card ${className}`} {...props}>{children}</section>;
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="page-heading">
      <div>
        {eyebrow && <p className="page-heading__eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="page-heading__description">{description}</p>}
      </div>
      {actions && <div className="page-heading__actions">{actions}</div>}
    </header>
  );
}

export function MetricCard({ label, value, unit, context, tone = "neutral", icon }: { key?: string; label: string; value: ReactNode; unit?: string; context?: ReactNode; tone?: "neutral" | "info" | "success" | "warning" | "danger"; icon?: ReactNode }) {
  return (
    <article className="metric-card" data-tone={tone}>
      <div className="metric-card__top"><span>{label}</span>{icon && <span className="metric-card__icon">{icon}</span>}</div>
      <p className="metric-card__value">{value}{unit && <small>{unit}</small>}</p>
      {context && <div className="metric-card__context">{context}</div>}
    </article>
  );
}

const statusMap: Record<string, { label: string; tone: string; icon: ReactNode }> = {
  draft: { label: "Bản nháp", tone: "neutral", icon: <CircleAlert /> },
  submitted: { label: "Chờ duyệt", tone: "info", icon: <CircleAlert /> },
  needs_revision: { label: "Cần chỉnh sửa", tone: "warning", icon: <AlertTriangle /> },
  approved: { label: "Đã duyệt", tone: "success", icon: <CheckCircle2 /> },
  locked: { label: "Đã khóa", tone: "neutral", icon: <CheckCircle2 /> },
  published: { label: "Đã công bố", tone: "success", icon: <CheckCircle2 /> },
  pending: { label: "Chờ nhận", tone: "warning", icon: <CircleAlert /> },
  pending_review: { label: "Chờ duyệt", tone: "warning", icon: <CircleAlert /> },
  received: { label: "Đã tiếp nhận", tone: "info", icon: <Inbox /> },
  verifying: { label: "Đang xác minh", tone: "warning", icon: <Search /> },
  assigned: { label: "Đã phân công", tone: "assigned", icon: <UserCheck /> },
  in_progress: { label: "Đang xử lý", tone: "progress", icon: <Wrench /> },
  completed: { label: "Hoàn tất", tone: "success", icon: <CheckCircle2 /> },
  out_of_scope: { label: "Không thuộc thẩm quyền", tone: "neutral", icon: <Ban /> },
  accepted: { label: "Đã chấp nhận", tone: "success", icon: <CheckCircle2 /> },
  rejected: { label: "Đã từ chối", tone: "danger", icon: <XCircle /> },
  ready: { label: "Đạt", tone: "success", icon: <CheckCircle2 /> },
  needs_review: { label: "Cần rà soát", tone: "warning", icon: <AlertTriangle /> },
  blocked: { label: "Bị chặn", tone: "danger", icon: <AlertTriangle /> },
  cancelled: { label: "Đã hủy", tone: "neutral", icon: <CircleAlert /> },
  overdue: { label: "Quá hạn", tone: "danger", icon: <AlertTriangle /> },
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const config = statusMap[status] ?? { label: status, tone: "neutral", icon: <CircleAlert /> };
  return (
    <span className="status-badge" data-tone={config.tone} data-status={status}>
      {config.icon}
      {label ?? config.label}
    </span>
  );
}

export function DataScope({ period, scope, quality }: { period?: string; scope?: string; quality?: string }) {
  return (
    <dl className="data-scope" aria-label="Phạm vi dữ liệu">
      <div><dt>Kỳ dữ liệu</dt><dd>{period || "Chưa xác định"}</dd></div>
      <div><dt>Phạm vi</dt><dd>{scope || "Chưa xác định"}</dd></div>
      {quality && <div><dt>Chất lượng</dt><dd>{quality}</dd></div>}
    </dl>
  );
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><Inbox aria-hidden="true" /><h3>{title}</h3><p>{description}</p>{action}</div>;
}

export function ErrorState({ title = "Không tải được dữ liệu", description, onRetry }: { title?: string; description: string; onRetry?: () => void }) {
  return <div className="error-state" role="alert"><CircleAlert aria-hidden="true" /><div><h3>{title}</h3><p>{description}</p>{onRetry && <button type="button" className="button button--secondary" onClick={onRetry}><RotateCw />Thử lại</button>}</div></div>;
}

export function FilterBar({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`filter-bar ${className}`}>{children}</div>;
}

export function StickyActionBar({ children }: { children: ReactNode }) {
  return <div className="sticky-action-bar">{children}</div>;
}

export function ActionCard({ title, meta, status, children }: { key?: string; title: string; meta?: ReactNode; status?: ReactNode; children?: ReactNode }) {
  return <article className="action-card"><div><h3>{title}</h3>{meta && <div className="action-card__meta">{meta}</div>}</div><div className="action-card__actions">{status}{children}</div></article>;
}

export function Button({ variant = "primary", className = "", children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "quiet" | "danger" }) {
  return <button className={`button button--${variant} ${className}`} {...props}>{children}</button>;
}
