import { useId, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";
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
    <div className="brand-wordmark" data-inverse={inverse || undefined} aria-label="Ba Na SmartLink">
      <span className="brand-wordmark__mark" aria-hidden="true">
        <img
          src="/images/ba-na-brand-mark-96.png"
          srcSet="/images/ba-na-brand-mark-96.png 1x, /images/ba-na-brand-mark-192.png 2x"
          width="96"
          height="96"
          alt=""
        />
      </span>
      <span className="brand-wordmark__copy">
        <strong>Ba Na SmartLink</strong>
        {!compact && <small>Hệ thống dữ liệu và báo cáo cấp xã</small>}
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

export function BaNaBrandScenery({ className = "" }: { className?: string }) {
  const prefix = useId().replace(/:/g, "");
  const skyId = `${prefix}-sky`;
  const farId = `${prefix}-far`;
  const nearId = `${prefix}-near`;
  const digitalId = `${prefix}-digital`;
  const goldId = `${prefix}-gold`;

  return (
    <svg
      aria-hidden="true"
      className={`brand-scenery ${className}`}
      viewBox="0 0 1400 560"
      preserveAspectRatio="xMidYMax slice"
      fill="none"
    >
      <defs>
        <linearGradient id={skyId} x1="182" y1="10" x2="1188" y2="517" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2C8A69" stopOpacity="0.08" />
          <stop offset="0.5" stopColor="#0B4A35" stopOpacity="0.18" />
          <stop offset="1" stopColor="#063629" stopOpacity="0.72" />
        </linearGradient>
        <linearGradient id={farId} x1="0" y1="180" x2="1268" y2="481" gradientUnits="userSpaceOnUse">
          <stop stopColor="#B7D8CC" stopOpacity="0.18" />
          <stop offset="1" stopColor="#79B69E" stopOpacity="0.58" />
        </linearGradient>
        <linearGradient id={nearId} x1="158" y1="268" x2="1194" y2="551" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0D6048" stopOpacity="0.54" />
          <stop offset="1" stopColor="#073528" stopOpacity="0.96" />
        </linearGradient>
        <linearGradient id={digitalId} x1="118" y1="469" x2="1260" y2="278" gradientUnits="userSpaceOnUse">
          <stop stopColor="#67D8EF" />
          <stop offset="0.48" stopColor="#19A9C7" />
          <stop offset="1" stopColor="#256EDB" />
        </linearGradient>
        <linearGradient id={goldId} x1="66" y1="478" x2="1288" y2="328" gradientUnits="userSpaceOnUse">
          <stop stopColor="#F5D66F" />
          <stop offset="0.45" stopColor="#DAAF37" />
          <stop offset="1" stopColor="#B77E10" />
        </linearGradient>
        <filter id={`${prefix}-glow`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="10" />
        </filter>
      </defs>

      <ellipse cx="1118" cy="122" rx="190" ry="132" fill={`url(#${skyId})`} />
      <circle cx="1122" cy="116" r="55" fill="#F3D26C" fillOpacity="0.2" filter={`url(#${prefix}-glow)`} />
      <circle cx="1122" cy="116" r="25" fill="#F5D66F" fillOpacity="0.32" />

      <path
        className="brand-scenery__mountain brand-scenery__mountain--far"
        d="M-40 428C83 342 183 360 275 303C368 245 430 181 516 205C592 227 626 322 704 318C797 313 848 192 939 187C1029 181 1077 299 1160 302C1240 305 1282 244 1448 214V560H-40V428Z"
        fill={`url(#${farId})`}
      />
      <path
        className="brand-scenery__ridge"
        d="M208 353L379 244L461 296L542 221L675 341L823 223L967 334L1089 238L1276 367"
        stroke="#E7F3EE"
        strokeOpacity="0.24"
        strokeWidth="3"
      />
      <path
        className="brand-scenery__mountain brand-scenery__mountain--near"
        d="M-48 492C88 413 187 397 308 413C407 426 472 365 566 339C688 306 751 437 856 427C959 417 1031 339 1146 347C1243 354 1317 409 1448 402V560H-48V492Z"
        fill={`url(#${nearId})`}
      />

      <path
        className="brand-scenery__golden-road"
        d="M40 491C258 443 429 407 610 409C814 412 953 461 1355 330"
        stroke={`url(#${goldId})`}
        strokeWidth="13"
        strokeLinecap="round"
      />
      <path
        className="brand-scenery__digital-trail"
        d="M62 466C281 423 427 369 629 377C846 385 1015 423 1342 286"
        stroke={`url(#${digitalId})`}
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray="18 15"
      />

      {[
        [145, 450],
        [357, 396],
        [603, 377],
        [835, 404],
        [1070, 389],
        [1263, 320],
      ].map(([cx, cy], index) => (
        <g key={`${cx}-${cy}`} className="brand-scenery__node" style={{ animationDelay: `${index * 180}ms` }}>
          <circle cx={cx} cy={cy} r="12" fill="#083F2F" fillOpacity="0.82" stroke="#8DE8F4" strokeWidth="2" />
          <circle cx={cx} cy={cy} r="3.5" fill="#FFFFFF" />
        </g>
      ))}

      <g className="brand-scenery__network" stroke="#8DE8F4" strokeOpacity="0.35" strokeWidth="1.6">
        <path d="M948 196L1024 244L1105 214L1177 261L1253 220" />
        <path d="M1024 244L1062 306L1177 261L1214 329" />
        <circle cx="948" cy="196" r="5" fill="#8DE8F4" />
        <circle cx="1024" cy="244" r="5" fill="#8DE8F4" />
        <circle cx="1105" cy="214" r="5" fill="#8DE8F4" />
        <circle cx="1177" cy="261" r="5" fill="#8DE8F4" />
        <circle cx="1253" cy="220" r="5" fill="#8DE8F4" />
        <circle cx="1062" cy="306" r="5" fill="#8DE8F4" />
        <circle cx="1214" cy="329" r="5" fill="#8DE8F4" />
      </g>
    </svg>
  );
}

export function SectionCard({ children, className = "", ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={`ui-card ${className}`} {...props}>{children}</section>;
}

type WorkSectionProps = Omit<HTMLAttributes<HTMLElement>, "title"> & {
  index: string;
  title: string;
  description: string;
  tone?: "focus" | "tasks" | "evidence" | "support" | "innovation";
  icon?: ReactNode;
  actions?: ReactNode;
};

export function WorkSection({
  index,
  title,
  description,
  tone = "focus",
  icon,
  actions,
  children,
  className = "",
  ...props
}: WorkSectionProps) {
  const headingId = useId();

  return (
    <section
      className={`work-section ${className}`}
      data-tone={tone}
      aria-labelledby={headingId}
      {...props}
    >
      <header className="work-section__header">
        <span className="work-section__index" aria-hidden="true">
          {index}
        </span>
        {icon && (
          <span className="work-section__icon" aria-hidden="true">
            {icon}
          </span>
        )}
        <div className="work-section__heading">
          <p className="work-section__eyebrow">Nhóm công việc {index}</p>
          <h2 id={headingId}>{title}</h2>
          <p>{description}</p>
        </div>
        {actions && <div className="work-section__actions">{actions}</div>}
      </header>
      <div className="work-section__body">{children}</div>
    </section>
  );
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
  good: { label: "Tốt", tone: "success", icon: <CheckCircle2 /> },
  suspect: { label: "Cần kiểm tra", tone: "warning", icon: <AlertTriangle /> },
  bad: { label: "Không đạt", tone: "danger", icon: <XCircle /> },
  uncalibrated: { label: "Chưa hiệu chuẩn", tone: "neutral", icon: <CircleAlert /> },
  open: { label: "Đang mở", tone: "warning", icon: <CircleAlert /> },
  acknowledged: { label: "Đã xác nhận", tone: "info", icon: <CheckCircle2 /> },
  resolved: { label: "Đã giải quyết", tone: "success", icon: <CheckCircle2 /> },
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const config = statusMap[status] ?? { label: "Trạng thái khác", tone: "neutral", icon: <CircleAlert /> };
  return (
    <span className="status-badge" data-tone={config.tone} data-status={status}>
      {config.icon}
      {label ?? config.label}
    </span>
  );
}

export function DataScope({ period, scope, quality, qualityLabel = "Chất lượng" }: { period?: string; scope?: string; quality?: string; qualityLabel?: string }) {
  return (
    <dl className="data-scope" aria-label="Phạm vi dữ liệu">
      <div><dt>Kỳ dữ liệu</dt><dd>{period || "Chưa xác định"}</dd></div>
      <div><dt>Phạm vi</dt><dd>{scope || "Chưa xác định"}</dd></div>
      {quality && <div><dt>{qualityLabel}</dt><dd>{quality}</dd></div>}
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
