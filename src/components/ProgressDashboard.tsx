import { useEffect, useMemo, useState } from "react";
import "./ProgressDashboard.css";
import { apiFetch } from "../lib/apiClient";

type DashboardColor = "green" | "yellow" | "red";
type ReportStatus = "chua_nop" | "dung_han" | "tre_han";

type VillageStatus = {
  village_id: string;
  village_name: string;
  old_village_names: string[];
  report_id: string | null;
  submitted_at: string | null;
  due_date: string | null;
  days_late: number;
  status: ReportStatus;
  dashboard_color: DashboardColor;
};

type ReportsStatusResponse = {
  period_id: string;
  villages: VillageStatus[];
};

type ProgressDashboardProps = {
  periodId?: string;
  currentPeriod?: string;
  apiBaseUrl?: string;
};

const STATUS_LABELS: Record<ReportStatus, string> = {
  chua_nop: "Chưa nộp",
  dung_han: "Đúng hạn",
  tre_han: "Trễ hạn",
};

const STATUS_DOT_LABELS: Record<DashboardColor, string> = {
  green: "Đúng hạn",
  yellow: "Trễ hạn",
  red: "Chưa nộp hoặc quá hạn",
};

const viteApiBaseUrl =
  (import.meta as unknown as { env?: { VITE_API_BASE_URL?: string } }).env
    ?.VITE_API_BASE_URL ?? "";

type TrendAlert = {
  village_id: string;
  village_name: string;
  ct_code: string;
  indicator_name: string;
  prev_value: number;
  curr_value: number;
  change_pct: number;
};

type PeriodItem = {
  id: string;
  name: string;
  due_date: string;
};

export default function ProgressDashboard({
  periodId,
  currentPeriod,
  apiBaseUrl = viteApiBaseUrl,
}: ProgressDashboardProps) {
  const activePeriodId = periodId || currentPeriod || "";
  const [villages, setVillages] = useState<VillageStatus[]>([]);
  const [alerts, setAlerts] = useState<TrendAlert[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingAlerts, setIsLoadingAlerts] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const abortController = new AbortController();

    async function loadData() {
      setIsLoading(true);
      setIsLoadingAlerts(true);
      setErrorMessage(null);

      try {
        // 1. Fetch status of submissions
        const statusParams = new URLSearchParams({ period_id: activePeriodId });
        const statusResponse = await apiFetch(`/reports/status?${statusParams}`, {
          signal: abortController.signal,
        });
        if (!statusResponse.ok) {
          const errData = await statusResponse.json().catch(() => null);
          const detail = errData?.detail || statusResponse.statusText;
          throw new Error(detail ? `Lỗi máy chủ: ${detail}` : "Không thể kết nối đến máy chủ lấy trạng thái tiến độ.");
        }
        const statusPayload = (await statusResponse.json()) as ReportsStatusResponse;
        setVillages(statusPayload.villages);

        // 2. Fetch periods to find the previous period
        const periodsResponse = await apiFetch(`/reports/periods`, {
          signal: abortController.signal,
        });
        if (!periodsResponse.ok) {
          // Graceful warning rather than crashing completely
          console.warn("Không tải được danh sách kỳ báo cáo.");
          setIsLoadingAlerts(false);
          return;
        }
        const periods = (await periodsResponse.json()) as PeriodItem[];

        // Use backend resolved period_id UUID for correct index finding
        const resolvedPeriodId = statusPayload.period_id;
        const currentIndex = periods.findIndex((p) => p.id === resolvedPeriodId);
        if (currentIndex !== -1 && currentIndex + 1 < periods.length) {
          const prevPeriodId = periods[currentIndex + 1].id;

          // 3. Fetch trend alerts
          const alertParams = new URLSearchParams({
            curr_period_id: resolvedPeriodId,
            prev_period_id: prevPeriodId,
          });
          const alertsResponse = await apiFetch(
            `/reports/trend-alerts?${alertParams}`,
            { signal: abortController.signal }
          );
          if (alertsResponse.ok) {
            const alertsPayload = (await alertsResponse.json()) as TrendAlert[];
            setAlerts(alertsPayload);
          }
        }
      } catch (error: any) {
        if (!abortController.signal.aborted) {
          let msg = "Có lỗi xảy ra khi tải dữ liệu tiến độ.";
          if (error && error.message) {
            const errStr = error.message.toLowerCase();
            if (errStr.includes("unexpected token") || errStr.includes("is not valid json")) {
              msg = "Kỳ báo cáo này chưa được khởi tạo hoặc chưa có số liệu nộp.";
            } else if (errStr.includes("failed to fetch")) {
              msg = "Không thể kết nối đến máy chủ lấy trạng thái tiến độ.";
            } else {
              msg = error.message;
            }
          }
          setErrorMessage(msg);
        }
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
          setIsLoadingAlerts(false);
        }
      }
    }

    void loadData();
    return () => abortController.abort();
  }, [apiBaseUrl, periodId]);

  const summary = useMemo(() => {
    const totalVillages = villages.length;
    const submittedVillages = villages.filter(
      (village) => village.status !== "chua_nop",
    ).length;
    const submittedRate =
      totalVillages === 0 ? 0 : Math.round((submittedVillages / totalVillages) * 100);

    return { submittedRate, submittedVillages, totalVillages };
  }, [villages]);

  return (
    <section className="progress-dashboard" aria-busy={isLoading}>
      <div className="progress-dashboard__summary" aria-label="Tổng quan tiến độ">
        <div>
          <p className="progress-dashboard__eyebrow">Tiến độ nộp báo cáo</p>
          <h2>Dashboard 10 thôn mới</h2>
        </div>
        <dl className="progress-dashboard__metrics">
          <div className="progress-dashboard__metric">
            <dt>Tổng số thôn</dt>
            <dd>{summary.totalVillages}</dd>
          </div>
          <div className="progress-dashboard__metric">
            <dt>Đã nộp</dt>
            <dd>{summary.submittedVillages}</dd>
          </div>
          <div className="progress-dashboard__metric">
            <dt>Tỷ lệ nộp</dt>
            <dd>{summary.submittedRate}%</dd>
          </div>
        </dl>
      </div>

      {errorMessage ? (
        <div className="progress-dashboard__notice" role="alert">
          {errorMessage}
        </div>
      ) : null}

      <div className="progress-dashboard__table-wrap">
        <table className="progress-dashboard__table">
          <thead>
            <tr>
              <th scope="col">STT</th>
              <th scope="col">Thôn</th>
              <th scope="col">Trạng thái</th>
              <th scope="col">Ngày nộp</th>
              <th scope="col">Số ngày trễ</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={5}>Đang tải...</td>
              </tr>
            ) : null}

            {!isLoading && villages.length === 0 ? (
              <tr>
                <td colSpan={5}>Chưa có dữ liệu tiến độ.</td>
              </tr>
            ) : null}

            {!isLoading
              ? villages.map((village, index) => (
                  <tr key={village.village_id}>
                    <td>{index + 1}</td>
                    <td>
                      <span className="progress-dashboard__village-name">
                        {village.village_name}
                      </span>
                    </td>
                    <td>
                      <span className="progress-dashboard__status">
                        <span
                          className={`progress-dashboard__dot progress-dashboard__dot--${village.dashboard_color}`}
                          aria-label={STATUS_DOT_LABELS[village.dashboard_color]}
                          role="img"
                        />
                        {STATUS_LABELS[village.status]}
                      </span>
                    </td>
                    <td>{formatDate(village.submitted_at)}</td>
                    <td>{formatDaysLate(village.days_late)}</td>
                  </tr>
                ))
              : null}
          </tbody>
        </table>
      </div>

      {/* Biến động đáng chú ý kỳ này */}
      {!isLoadingAlerts && alerts.length > 0 ? (
        <div className="progress-dashboard__alerts-section">
          <h3>Biến động đáng chú ý kỳ này (&gt; 20%)</h3>
          <div className="progress-dashboard__table-wrap">
            <table className="progress-dashboard__table progress-dashboard__table--alerts">
              <thead>
                <tr>
                  <th scope="col" style={{ width: "20%" }}>Thôn</th>
                  <th scope="col" style={{ width: "40%" }}>Chỉ tiêu</th>
                  <th scope="col" style={{ width: "13%" }}>Kỳ trước</th>
                  <th scope="col" style={{ width: "13%" }}>Kỳ này</th>
                  <th scope="col" style={{ width: "14%" }}>Biến động</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((alert) => (
                  <tr key={`${alert.village_id}-${alert.ct_code}`}>
                    <td>
                      <span className="progress-dashboard__village-name">
                        {alert.village_name}
                      </span>
                    </td>
                    <td>{alert.indicator_name} ({alert.ct_code})</td>
                    <td>{alert.prev_value}</td>
                    <td>{alert.curr_value}</td>
                    <td>
                      <span className={`progress-dashboard__change-badge progress-dashboard__change-badge--${alert.change_pct >= 0 ? "positive" : "negative"}`}>
                        {alert.change_pct >= 0 ? `+${alert.change_pct}%` : `${alert.change_pct}%`}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

    </section>
  );
}

function formatDate(value: string | null): string {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function formatDaysLate(daysLate: number): string {
  if (daysLate <= 0) {
    return "-";
  }

  return `${daysLate} ngày`;
}
