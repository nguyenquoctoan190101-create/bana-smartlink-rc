import { useEffect, useMemo, useState } from "react";
import { CalendarDays, TableProperties } from "lucide-react";
import "./ProgressDashboard.css";
import { apiFetch, toUserFacingError } from "../lib/apiClient";
import { WorkSection } from "./ui";

type DashboardColor = "blue" | "green" | "yellow" | "red";
type ReportStatus = "not_submitted" | "overdue" | "on_time" | "late";

type VillageStatus = {
  village_id: string;
  village_name: string;
  old_village_names: string[];
  report_id: string | null;
  submitted_at: string | null;
  due_date: string | null;
  days_late: number | null;
  days_delta: number | null;
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
};

const STATUS_LABELS: Record<ReportStatus, string> = {
  not_submitted: "Chưa nộp, còn hạn",
  overdue: "Quá hạn, chưa nộp",
  on_time: "Đã nộp đúng hạn",
  late: "Đã nộp trễ",
};

const STATUS_ORDER: Record<ReportStatus, number> = {
  overdue: 0,
  late: 1,
  not_submitted: 2,
  on_time: 3,
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
}: ProgressDashboardProps) {
  const preferredPeriodId = periodId || currentPeriod || "";
  const [activePeriodId, setActivePeriodId] = useState(preferredPeriodId);
  const [villages, setVillages] = useState<VillageStatus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
      setErrorMessage(null);

      try {
        if (!activePeriodId) {
          setVillages([]);
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
        }
      }
    }

    void loadData();
    return () => abortController.abort();
  }, [activePeriodId]);

  const summary = useMemo(() => {
    const totalVillages = villages.length;
    const submittedVillages = villages.filter(
      (village) => village.status === "on_time" || village.status === "late",
    ).length;
    const submittedRate =
      totalVillages === 0 ? 0 : Math.round((submittedVillages / totalVillages) * 100);
    const overdueVillages = villages.filter(
      (village) => village.status === "overdue",
    ).length;

    return { overdueVillages, submittedRate, submittedVillages, totalVillages };
  }, [villages]);

  const orderedVillages = useMemo(
    () =>
      [...villages].sort(
        (left, right) =>
          STATUS_ORDER[left.status] - STATUS_ORDER[right.status] ||
          left.village_name.localeCompare(right.village_name, "vi"),
      ),
    [villages],
  );

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
            <div className="progress-dashboard__metric">
              <dt>Quá hạn chưa nộp</dt>
              <dd>{summary.overdueVillages}</dd>
            </div>
          </dl>
        </div>

        {errorMessage ? (
          <div className="progress-dashboard__notice" role="alert">
            {errorMessage}
          </div>
        ) : null}

        <div className="progress-dashboard__legend" aria-label="Chú giải trạng thái">
          <span><i className="progress-dashboard__dot progress-dashboard__dot--green" aria-hidden="true" /> Đã nộp đúng hạn</span>
          <span><i className="progress-dashboard__dot progress-dashboard__dot--yellow" aria-hidden="true" /> Đã nộp trễ</span>
          <span><i className="progress-dashboard__dot progress-dashboard__dot--blue" aria-hidden="true" /> Chưa nộp, còn hạn</span>
          <span><i className="progress-dashboard__dot progress-dashboard__dot--red" aria-hidden="true" /> Quá hạn, chưa nộp</span>
          <span className="progress-dashboard__legend-note">Hạn và ngày nộp lấy từ máy chủ; “—” là chưa có bằng chứng.</span>
        </div>
      </WorkSection>

      <WorkSection
        index="02"
        title="Tiến độ chi tiết theo thôn"
        description="Mỗi dòng là một đơn vị báo cáo độc lập, đặt hạn nộp cạnh ngày gửi và chênh lệch ngày để thấy rõ việc cần xử lý."
        tone="tasks"
        icon={<TableProperties />}
      >
        <div className="progress-dashboard__table-wrap table-scroll-region focus-visible:ring-2 focus-visible:ring-emerald-700" tabIndex={0} aria-label="Bảng tiến độ theo thôn; có thể cuộn ngang trên màn hình nhỏ">
          <span className="sticky left-3 z-10 my-2 ml-3 inline-flex rounded-full bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-900 lg:hidden">
            Vuốt ngang để xem thêm →
          </span>
          <table className="progress-dashboard__table">
            <caption className="sr-only">
              Tiến độ báo cáo theo thôn, gồm trạng thái, hạn nộp, ngày nộp và
              chênh lệch so với hạn
            </caption>
            <thead>
              <tr>
                <th scope="col">STT</th>
                <th scope="col">Thôn</th>
                <th scope="col">Trạng thái</th>
                <th scope="col">Hạn nộp</th>
                <th scope="col">Ngày nộp</th>
                <th scope="col">Chênh lệch với hạn</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={6}>Đang tải...</td>
                </tr>
              ) : null}

              {!isLoading && villages.length === 0 ? (
                <tr>
                  <td colSpan={6}>Chưa có dữ liệu tiến độ.</td>
                </tr>
              ) : null}

              {!isLoading
                ? orderedVillages.map((village, index) => (
                    <tr key={village.village_id}>
                      <td>{index + 1}</td>
                      <th scope="row">
                        <span className="progress-dashboard__village-name">
                          {village.village_name}
                        </span>
                      </th>
                      <td>
                        <span className="progress-dashboard__status">
                          <span
                            className={`progress-dashboard__dot progress-dashboard__dot--${village.dashboard_color}`}
                            aria-hidden="true"
                          />
                          {STATUS_LABELS[village.status]}
                        </span>
                      </td>
                      <td>{formatDate(village.due_date)}</td>
                      <td>{formatDate(village.submitted_at)}</td>
                      <td>
                        {formatDaysDelta(
                          village.status,
                          village.days_delta,
                          village.due_date,
                        )}
                      </td>
                    </tr>
                  ))
                : null}
            </tbody>
          </table>
        </div>
      </WorkSection>

      <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600" role="status">
        So sánh qua kỳ chưa bật vì registry chưa có quy tắc so sánh, ngưỡng tuyệt
        đối và tương đối, baseline, hướng biến động và chủ sở hữu được phê duyệt.
      </div>

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
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(date);
}

function formatDaysDelta(
  status: ReportStatus,
  daysDelta: number | null,
  dueDate: string | null,
): string {
  if (!dueDate) return "Chưa đặt hạn";
  if (daysDelta == null || !Number.isFinite(daysDelta)) return "—";
  if (status === "overdue") return `Quá hạn ${Math.max(0, daysDelta)} ngày`;
  if (status === "late") return `Muộn ${Math.max(0, daysDelta)} ngày`;
  if (status === "not_submitted") {
    if (daysDelta < 0) return `Còn ${Math.abs(daysDelta)} ngày`;
    if (daysDelta === 0) return "Hạn hôm nay";
    return `Quá hạn ${daysDelta} ngày`;
  }
  if (daysDelta < 0) return `Sớm ${Math.abs(daysDelta)} ngày`;
  if (daysDelta === 0) return "Đúng hạn";
  return `Muộn ${daysDelta} ngày`;
}
