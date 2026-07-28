import { useEffect, useMemo, useState } from "react";
import { CalendarDays, GitCompareArrows, TableProperties } from "lucide-react";
import "./ProgressDashboard.css";
import { apiFetch, toUserFacingError } from "../lib/apiClient";
import { WorkSection } from "./ui";

type DashboardColor = "green" | "yellow" | "red";
type ReportStatus = "not_submitted" | "on_time" | "late";

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
  periods?: PeriodItem[];
  apiBaseUrl?: string;
};

const STATUS_LABELS: Record<ReportStatus, string> = {
  not_submitted: "Chưa nộp",
  on_time: "Đúng hạn",
  late: "Trễ hạn",
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
  display_name?: string;
};
const EMPTY_PERIODS: PeriodItem[] = [];

export default function ProgressDashboard({
  periodId,
  currentPeriod,
  periods: availablePeriods = EMPTY_PERIODS,
  apiBaseUrl = viteApiBaseUrl,
}: ProgressDashboardProps) {
  const preferredPeriodId = periodId || currentPeriod || "";
  const [activePeriodId, setActivePeriodId] = useState(preferredPeriodId);
  const [villages, setVillages] = useState<VillageStatus[]>([]);
  const [alerts, setAlerts] = useState<TrendAlert[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingAlerts, setIsLoadingAlerts] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [alertsError, setAlertsError] = useState<string | null>(null);

  useEffect(() => {
    if (
      !activePeriodId ||
      (availablePeriods.length > 0 &&
        !availablePeriods.some((period) => period.id === activePeriodId))
    ) {
      setActivePeriodId(preferredPeriodId || availablePeriods[0]?.id || "");
    }
  }, [activePeriodId, availablePeriods, preferredPeriodId]);

  useEffect(() => {
    const abortController = new AbortController();

    async function loadData() {
      setIsLoading(true);
      setIsLoadingAlerts(true);
      setErrorMessage(null);
      setAlertsError(null);

      try {
        // 1. Fetch status of submissions
        if (!activePeriodId) {
          setVillages([]);
          setAlerts([]);
          return;
        }
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

        // Trend comparison is supplementary. Keep the primary progress table
        // visible if this secondary chain fails, but tell the user that the
        // absence of alerts is not an authoritative "no change" conclusion.
        try {
          const periodsResponse = await apiFetch(`/reports/periods`, {
            signal: abortController.signal,
          });
          if (!periodsResponse.ok) {
            throw new Error("Không tải được danh sách kỳ để đối chiếu.");
          }
          const periods = (await periodsResponse.json()) as PeriodItem[];

          // Use backend resolved period_id UUID for correct index finding
          const resolvedPeriodId = statusPayload.period_id;
          const currentIndex = periods.findIndex((p) => p.id === resolvedPeriodId);
          if (currentIndex !== -1 && currentIndex + 1 < periods.length) {
            const prevPeriodId = periods[currentIndex + 1].id;
            const alertParams = new URLSearchParams({
              curr_period_id: resolvedPeriodId,
              prev_period_id: prevPeriodId,
            });
            const alertsResponse = await apiFetch(
              `/reports/trend-alerts?${alertParams}`,
              { signal: abortController.signal },
            );
            if (!alertsResponse.ok) {
              throw new Error("Không tải được dữ liệu biến động giữa hai kỳ.");
            }
            const alertsPayload = (await alertsResponse.json()) as TrendAlert[];
            setAlerts(alertsPayload);
          }
        } catch (optionalError) {
          if (!abortController.signal.aborted) {
            setAlerts([]);
            setAlertsError(
              toUserFacingError(
                optionalError,
                "Đã tải tiến độ nộp báo cáo nhưng chưa đối chiếu được biến động với kỳ trước.",
              ),
            );
          }
        }
      } catch (error) {
        if (!abortController.signal.aborted) {
          let msg = toUserFacingError(error, "Có lỗi xảy ra khi tải dữ liệu tiến độ.");
          if (error instanceof Error) {
            const errStr = error.message.toLowerCase();
            if (errStr.includes("unexpected token") || errStr.includes("is not valid json")) {
              msg = "Kỳ báo cáo này chưa được khởi tạo hoặc chưa có số liệu nộp.";
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
  }, [activePeriodId, apiBaseUrl]);

  const summary = useMemo(() => {
    const totalVillages = villages.length;
    const submittedVillages = villages.filter(
      (village) => village.status === "on_time" || village.status === "late",
    ).length;
    const submittedRate =
      totalVillages === 0 ? 0 : Math.round((submittedVillages / totalVillages) * 100);

    return { submittedRate, submittedVillages, totalVillages };
  }, [villages]);

  return (
    <section className="progress-dashboard" aria-busy={isLoading}>
      <WorkSection
        index="01"
        title="Phạm vi và tổng quan tiến độ"
        description="Chọn kỳ theo dõi, đọc tỷ lệ nộp và chú giải trạng thái trước khi đi vào danh sách từng thôn."
        tone="focus"
        icon={<CalendarDays />}
      >
        <div className="progress-dashboard__summary" aria-label="Tổng quan tiến độ">
          <div className="progress-dashboard__heading">
            <p className="progress-dashboard__eyebrow">Tiến độ nộp báo cáo</p>
            <h1>Tiến độ báo cáo theo thôn</h1>
            {availablePeriods.length > 0 ? (
              <label className="progress-dashboard__period-picker">
                <span>Kỳ theo dõi</span>
                <select
                  value={activePeriodId}
                  onChange={(event) => setActivePeriodId(event.target.value)}
                >
                  {availablePeriods.map((period) => (
                    <option key={period.id} value={period.id}>
                      {period.display_name || period.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
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

        {alertsError ? (
          <div className="progress-dashboard__notice" role="status">
            {alertsError} Phần tiến độ bên dưới vẫn sử dụng được.
          </div>
        ) : null}

        <div className="progress-dashboard__legend" aria-label="Chú giải trạng thái">
          <span><i className="progress-dashboard__dot progress-dashboard__dot--green" aria-hidden="true" /> Đúng hạn</span>
          <span><i className="progress-dashboard__dot progress-dashboard__dot--yellow" aria-hidden="true" /> Trễ hạn</span>
          <span><i className="progress-dashboard__dot progress-dashboard__dot--red" aria-hidden="true" /> Chưa nộp / quá hạn</span>
          <span className="progress-dashboard__legend-note">Ngày nộp lấy từ máy chủ; “—” là chưa nộp.</span>
        </div>
      </WorkSection>

      <WorkSection
        index="02"
        title="Tiến độ chi tiết theo thôn"
        description="Mỗi dòng là một đơn vị báo cáo độc lập, thể hiện trạng thái nộp, thời điểm gửi và số ngày trễ."
        tone="tasks"
        icon={<TableProperties />}
      >
        <div className="progress-dashboard__table-wrap table-scroll-region focus-visible:ring-2 focus-visible:ring-emerald-700" tabIndex={0} aria-label="Bảng tiến độ theo thôn; có thể cuộn ngang trên màn hình nhỏ">
          <span className="sticky left-3 z-10 my-2 ml-3 inline-flex rounded-full bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-900 lg:hidden">
            Vuốt ngang để xem thêm →
          </span>
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
      </WorkSection>

      {/* Biến động đáng chú ý kỳ này */}
      {!isLoadingAlerts && alerts.length > 0 ? (
        <WorkSection
          index="03"
          title="Biến động cần rà soát"
          description="Tách riêng các chỉ tiêu thay đổi trên 20% so với kỳ trước để không trộn với tiến độ nộp báo cáo."
          tone="evidence"
          icon={<GitCompareArrows />}
        >
          <div className="progress-dashboard__alerts-section">
            <h3>Biến động đáng chú ý kỳ này (&gt; 20%)</h3>
            <div className="progress-dashboard__table-wrap table-scroll-region focus-visible:ring-2 focus-visible:ring-emerald-700" tabIndex={0} aria-label="Bảng biến động cần rà soát; có thể cuộn ngang trên màn hình nhỏ">
              <span className="sticky left-3 z-10 my-2 ml-3 inline-flex rounded-full bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-900 lg:hidden">
                Vuốt ngang để xem thêm →
              </span>
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
                      <span
                        className="progress-dashboard__change-badge progress-dashboard__change-badge--neutral"
                        aria-label={`${alert.change_pct >= 0 ? "Tăng" : "Giảm"} ${Math.abs(alert.change_pct)} phần trăm so với kỳ trước`}
                      >
                        {alert.change_pct >= 0 ? `+${alert.change_pct}%` : `${alert.change_pct}%`}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              </table>
            </div>
          </div>
        </WorkSection>
      ) : !isLoadingAlerts ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600" role="status">
          Không có biến động vượt ngưỡng 20% trong phạm vi so sánh, hoặc kỳ đang
          chọn chưa có kỳ trước đủ dữ liệu để đối chiếu.
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
