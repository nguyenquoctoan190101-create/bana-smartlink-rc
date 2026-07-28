import { useEffect, useMemo, useRef, useState } from "react";
import { ReportData, ReportPeriod, UserRole, workflowStatusOf } from "../types";
import { apiFetch, toUserFacingError } from "../lib/apiClient";
import {
  TrendingUp,
  Users,
  Home,
  HeartPulse,
  ShieldAlert,
  Award,
  FileText,
  Trash2,
  Edit,
  Cpu,
  HelpCircle,
  ChevronRight,
  BarChart3,
  Plus,
  FileSpreadsheet,
  X,
  Maximize2,
  CheckCircle,
  Lock,
  Globe2,
} from "lucide-react";
import { useVillages } from "../lib/useVillages";
import { useAuth } from "../lib/AuthContext";
import { preferredLeadershipPeriodId } from "../lib/reportPeriods";
import { evaluateMetric } from "../lib/metricRegistry";
import { reportToMetricEvaluationReport } from "../lib/reportMetrics";
import { formatViNumber, formatViPercent } from "../lib/formatters";
import { Button, DataScope, PageHeader, SectionCard, StatusBadge, WorkSection } from "./ui";
import "./Dashboard.css";
import DashboardInsightCharts from "./DashboardInsightCharts";

interface DashboardProps {
  reports: ReportData[];
  onEditReport: (report: ReportData) => void;
  onDeleteReport: (report: ReportData, localOnly?: boolean) => void;
  onApproveReport?: (report: ReportData) => void;
  onLockReport?: (report: ReportData) => void;
  onPublishReport?: (report: ReportData) => void;
  onAddNewReport: (periodId?: string) => void;
  userRole?: UserRole;
  reportPeriods?: ReportPeriod[];
}

const ALL_PERIODS = "__all_periods__";

export function buildDashboardChartScale(reports: ReportData[]) {
  const observedMax = reports.reduce((maximum, report) => {
    const population = Number.isFinite(report.CT02) ? report.CT02 : 0;
    const households = Number.isFinite(report.CT01) ? report.CT01 : 0;
    return Math.max(maximum, population, households);
  }, 0);
  const rawStep = Math.max(1, observedMax) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = (Math.ceil((rawStep / magnitude) * 2) / 2) * magnitude;
  const max = Math.max(step * 4, 4);
  return {
    max,
    ticks: [max, max - step, max - step * 2, max - step * 3, 0],
  };
}

export interface DashboardPeriodOption {
  value: string;
  label: string;
  periodId?: string;
  periodName?: string;
  legacyName?: string;
}

export function filterDashboardReportsByPeriod(
  reports: ReportData[],
  reportPeriods: ReportPeriod[],
  selectedOption: DashboardPeriodOption,
): ReportData[] {
  if (selectedOption.value === ALL_PERIODS) {
    return Array.from(
      reports
        .reduce((latest, report) => {
          const previous = latest.get(report.village_id);
          if (
            !previous ||
            (report.updated_at || "") > (previous.updated_at || "")
          ) {
            latest.set(report.village_id, report);
          }
          return latest;
        }, new Map<string, ReportData>())
        .values(),
    );
  }

  if (selectedOption.legacyName) {
    return reports.filter(
      (report) => (
        !report.period_id &&
        report.report_period === selectedOption.legacyName
      ),
    );
  }
  if (!selectedOption.periodId) return [];

  let hasUniquePeriodName: boolean | undefined;
  const selectedPeriodNameIsUnique = () => {
    if (hasUniquePeriodName !== undefined) return hasUniquePeriodName;
    let sameNamePeriodCount = 0;
    for (const period of reportPeriods) {
      if (period.name !== selectedOption.periodName) continue;
      sameNamePeriodCount += 1;
      if (sameNamePeriodCount > 1) break;
    }
    hasUniquePeriodName = sameNamePeriodCount === 1;
    return hasUniquePeriodName;
  };

  return reports.filter((report) => {
    if (report.period_id === selectedOption.periodId) return true;
    if (report.period_id) return false;

    // Rows created before period_id became mandatory remain readable, but a
    // name fallback is safe only when it resolves to exactly one period.
    return (
      selectedPeriodNameIsUnique() &&
      report.report_period === selectedOption.periodName
    );
  });
}

export function buildDashboardPeriodOptions(
  reportPeriods: ReportPeriod[],
  reports: ReportData[],
): DashboardPeriodOption[] {
  const nameCounts = reportPeriods.reduce((counts, period) => {
    counts.set(period.name, (counts.get(period.name) || 0) + 1);
    return counts;
  }, new Map<string, number>());
  const knownIds = new Set(reportPeriods.map((period) => period.id));
  const knownNames = new Set(reportPeriods.map((period) => period.name));
  const options: DashboardPeriodOption[] = [
    { value: ALL_PERIODS, label: "Bản mới nhất của từng thôn (theo dõi)" },
  ];

  for (const period of reportPeriods) {
    const duplicateName = (nameCounts.get(period.name) || 0) > 1;
    const dueDate =
      duplicateName && period.due_date
        ? new Date(period.due_date).toLocaleDateString("vi-VN")
        : "";
    options.push({
      value: `period:${period.id}`,
      label: dueDate
        ? `${period.display_name ?? period.name} — hạn ${dueDate}`
        : (period.display_name ?? period.name),
      periodId: period.id,
      periodName: period.name,
    });
  }

  const legacyKeys = new Set<string>();
  for (const report of reports) {
    if (report.period_id && knownIds.has(report.period_id)) continue;
    if (!report.period_id && knownNames.has(report.report_period)) continue;
    const value = report.period_id
      ? `period:${report.period_id}`
      : `legacy:${report.report_period}`;
    if (legacyKeys.has(value)) continue;
    legacyKeys.add(value);
    options.push({
      value,
      label: `${report.report_period} — dữ liệu lịch sử`,
      periodId: report.period_id || undefined,
      periodName: report.report_period,
      legacyName: report.period_id ? undefined : report.report_period,
    });
  }

  return options;
}

export function splitDashboardReports(reports: ReportData[]) {
  return {
    localDrafts: reports
      .filter((report) => report.local_only)
      .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || "")),
    serverReports: reports.filter((report) => !report.local_only),
  };
}

/** Leadership totals and charts must never mix drafts or unreviewed submissions
 * with records that have passed the commune review gate. */
export function reportsForDecisionMetrics(reports: ReportData[]): ReportData[] {
  return reports.filter((report) => {
    const status = workflowStatusOf(report);
    return status === "approved" || status === "locked";
  });
}

export default function Dashboard({
  reports,
  onEditReport,
  onDeleteReport,
  onApproveReport,
  onLockReport,
  onPublishReport,
  onAddNewReport,
  userRole = "can_bo_thon",
  reportPeriods = [],
}: DashboardProps) {
  const { userVillageId, userVillageIds = [] } = useAuth();
  const { villages: new_villages } = useVillages();
  const [selectedPeriod, setSelectedPeriod] = useState<string>(ALL_PERIODS);
  const [selectedVillageFilter, setSelectedVillageFilter] =
    useState<string>("all");
  const [showChartModal, setShowChartModal] = useState<boolean>(false);
  const chartDialogRef = useRef<HTMLDivElement>(null);
  const chartCloseRef = useRef<HTMLButtonElement>(null);
  const chartTriggerRef = useRef<HTMLButtonElement>(null);
  const defaultPeriodInitializedRef = useRef(false);

  useEffect(() => {
    if (!showChartModal) return undefined;
    const dialog = chartDialogRef.current;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : chartTriggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    chartCloseRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setShowChartModal(false);
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      ) as HTMLElement[];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
        dialog.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [showChartModal]);

  const staffVillageIds = useMemo(() => {
    if (userRole === "can_bo_thon") {
      return userVillageId ? [userVillageId] : [];
    }
    if (userRole === "to_cnscd") return userVillageIds;
    return [];
  }, [userRole, userVillageId, userVillageIds]);
  const selectableVillages = useMemo(
    () =>
      userRole === "can_bo_thon" || userRole === "to_cnscd"
        ? new_villages.filter((village) => staffVillageIds.includes(village.id))
        : new_villages,
    [new_villages, staffVillageIds, userRole],
  );

  // Staff must never be invited by the interface to browse a village outside
  // their assignment ledger. The API and RLS remain the authorization authority.
  useEffect(() => {
    if (userRole !== "can_bo_thon" && userRole !== "to_cnscd") return;
    if (!staffVillageIds.length) {
      setSelectedVillageFilter("");
    } else if (staffVillageIds.length === 1) {
      setSelectedVillageFilter(staffVillageIds[0]);
    } else if (
      selectedVillageFilter !== "all" &&
      !staffVillageIds.includes(selectedVillageFilter)
    ) {
      setSelectedVillageFilter("all");
    }
  }, [selectedVillageFilter, staffVillageIds, userRole]);

  const effectiveVillageFilter =
    userRole === "can_bo_thon" || userRole === "to_cnscd"
      ? staffVillageIds.length === 1
        ? staffVillageIds[0]
        : selectedVillageFilter
      : selectedVillageFilter;
  const canExportSelectedScope =
    userRole === "admin_xa" ||
    userRole === "lanh_dao" ||
    ((userRole === "can_bo_thon" || userRole === "to_cnscd") &&
      staffVillageIds.length > 0 &&
      effectiveVillageFilter !== "all");

  const { localDrafts, serverReports } = useMemo(
    () => splitDashboardReports(reports),
    [reports],
  );

  // Period identity is the UUID, never the display name. Duplicate names are
  // valid historical data and must not merge two distinct report periods.
  const periodOptions = useMemo(
    () => buildDashboardPeriodOptions(reportPeriods, serverReports),
    [reportPeriods, serverReports],
  );
  const selectedPeriodOption =
    periodOptions.find((option) => option.value === selectedPeriod) ||
    periodOptions[0];
  const selectedPeriodLabel = selectedPeriodOption.label;

  useEffect(() => {
    if (defaultPeriodInitializedRef.current) return;
    const leadershipPeriodId =
      userRole === "lanh_dao"
        ? preferredLeadershipPeriodId(reportPeriods, serverReports)
        : "";
    const latestPeriod = leadershipPeriodId
      ? reportPeriods.find((period) => period.id === leadershipPeriodId)
      : [...reportPeriods]
          .filter((period) => Boolean(period.id))
          .sort((left, right) =>
            (right.due_date || "").localeCompare(left.due_date || ""),
          )[0];
    const preferredValue = latestPeriod
      ? `period:${latestPeriod.id}`
      : periodOptions.find((option) => option.value !== ALL_PERIODS)?.value;
    if (!preferredValue) return;
    setSelectedPeriod(preferredValue);
    defaultPeriodInitializedRef.current = true;
  }, [periodOptions, reportPeriods, serverReports, userRole]);

  useEffect(() => {
    if (!periodOptions.some((option) => option.value === selectedPeriod)) {
      setSelectedPeriod(ALL_PERIODS);
    }
  }, [periodOptions, selectedPeriod]);

  // "Tất cả kỳ" is a snapshot view: keep only the latest report per village,
  // otherwise population/household snapshots would be counted repeatedly.
  const periodReports = filterDashboardReportsByPeriod(
    serverReports,
    reportPeriods,
    selectedPeriodOption,
  );

  const decisionPeriodReports = filterDashboardReportsByPeriod(
    reportsForDecisionMetrics(serverReports),
    reportPeriods,
    selectedPeriodOption,
  );

  const filteredReports = periodReports.filter((r) => {
    const matchesVillage =
      effectiveVillageFilter === "all" ||
      r.village_id === effectiveVillageFilter;
    return matchesVillage;
  });
  const analyticsReports = decisionPeriodReports.filter(
    (report) =>
      effectiveVillageFilter === "all" ||
      report.village_id === effectiveVillageFilter,
  );
  const analyticsVillageIds = Array.from(
    new Set(analyticsReports.map((report) => report.village_id)),
  );
  const insightVillageId =
    effectiveVillageFilter && effectiveVillageFilter !== "all"
      ? effectiveVillageFilter
      : analyticsVillageIds.length === 1
        ? analyticsVillageIds[0]
        : "";
  const usesSingleVillageInsights = Boolean(insightVillageId);
  const insightHistoryReports = insightVillageId
    ? reportsForDecisionMetrics(serverReports).filter(
        (report) => report.village_id === insightVillageId,
      )
    : [];
  const detailReports =
    userRole === "lanh_dao" ? analyticsReports : filteredReports;
  const chartScale = useMemo(
    () => buildDashboardChartScale(filteredReports),
    [filteredReports],
  );

  const coveredVillageCount = new Set(
    analyticsReports.map((report) => report.village_id),
  ).size;
  const selectedPeriodDefinition = selectedPeriodOption.periodId
    ? reportPeriods.find(
        (period) => period.id === selectedPeriodOption.periodId,
      )
    : undefined;
  const assignedVillageIds = selectedPeriodDefinition?.village_ids;
  const expectedScopeVillageIds = selectableVillages
    .map((village) => village.id)
    .filter(
      (villageId) =>
        assignedVillageIds === undefined || assignedVillageIds.includes(villageId),
    );
  const expectedVillageCount =
    !effectiveVillageFilter
      ? 0
      : effectiveVillageFilter === "all"
      ? expectedScopeVillageIds.length
      : assignedVillageIds === undefined ||
          assignedVillageIds.includes(effectiveVillageFilter)
        ? 1
        : 0;
  const hasCompleteCoverage =
    expectedVillageCount > 0
      ? coveredVillageCount >= expectedVillageCount
      : analyticsReports.length > 0;
  const isCrossPeriodSnapshot = selectedPeriod === ALL_PERIODS;
  const canAggregateCurrentSlice =
    !isCrossPeriodSnapshot && analyticsReports.length > 0;
  useEffect(() => {
    if (isCrossPeriodSnapshot) setShowChartModal(false);
  }, [isCrossPeriodSnapshot]);

  // Metric identity uses the selected period UUID. Legacy rows receive this
  // resolved identity only after filterDashboardReportsByPeriod has proved
  // that their display name maps to this one period.
  const metricPeriodId =
    selectedPeriodOption.periodId || selectedPeriodOption.value;
  const expectedMetricVillageIds =
    effectiveVillageFilter === "all"
      ? expectedScopeVillageIds.length
        ? expectedScopeVillageIds
        : analyticsVillageIds
      : effectiveVillageFilter
        ? [effectiveVillageFilter]
        : [];
  const metricReports = analyticsReports.map((report) =>
    reportToMetricEvaluationReport(report, metricPeriodId),
  );
  const metricContext = {
    period_id: metricPeriodId,
    scope:
      effectiveVillageFilter === "all"
        ? "commune:ba-na"
        : `village:${effectiveVillageFilter}`,
    expected_village_ids: expectedMetricVillageIds,
  };
  const aggregateMetric = (metricId: string) =>
    canAggregateCurrentSlice
      ? evaluateMetric(metricId, metricReports, metricContext)
      : null;

  const householdsMetric = aggregateMetric("CT01");
  const populationMetric = aggregateMetric("CT02");
  const poorMetric = aggregateMetric("CT03");
  const nearPoorMetric = aggregateMetric("CT04");
  const revolutionContributorsMetric = aggregateMetric("CT05");
  const socialProtectionMetric = aggregateMetric("CT06");
  const childrenMetric = aggregateMetric("CT07");
  const childrenSpecialMetric = aggregateMetric("CT08");
  const culturalFamiliesMetric = aggregateMetric("CT09");
  const workingAgeMetric = aggregateMetric("CT10");
  const bhytCountMetric = aggregateMetric("CT11");
  const digitalTeamMetric = aggregateMetric("CT12");
  const onlineServiceGuidedMetric = aggregateMetric("CT13");
  // CT14 is deliberately non-aggregatable and therefore evaluates to null.
  const domesticViolenceMetric = aggregateMetric("CT14");
  const povertyMetric = aggregateMetric("poverty_household_rate");
  const nearPovertyMetric = aggregateMetric("near_poverty_household_rate");
  const bhytMetric = aggregateMetric("health_insurance_rate");
  const culturalFamilyMetric = aggregateMetric("cultural_family_rate");

  const totalHouseholds = householdsMetric?.value ?? null;
  const totalPopulation = populationMetric?.value ?? null;
  const totalPoor = poorMetric?.value ?? null;
  const totalNearPoor = nearPoorMetric?.value ?? null;
  const totalRevolutionContributors =
    revolutionContributorsMetric?.value ?? null;
  const totalSocialProtection = socialProtectionMetric?.value ?? null;
  const totalChildren = childrenMetric?.value ?? null;
  const totalChildrenSpecial = childrenSpecialMetric?.value ?? null;
  const totalCulturalFamilies = culturalFamiliesMetric?.value ?? null;
  const totalWorkingAge = workingAgeMetric?.value ?? null;
  const totalBHYT = bhytCountMetric?.value ?? null;
  const totalDigitalTeam = digitalTeamMetric?.value ?? null;
  const totalOnlineServiceGuided = onlineServiceGuidedMetric?.value ?? null;
  const totalDomesticViolence = domesticViolenceMetric?.value ?? null;
  const povertyRate = povertyMetric?.value ?? null;
  const nearPovertyRate = nearPovertyMetric?.value ?? null;
  const bhytRate = bhytMetric?.value ?? null;
  const culturalFamilyRate = culturalFamilyMetric?.value ?? null;

  const reportBhytRate = (report: ReportData): number | null => {
    const periodId =
      report.period_id
      || (selectedPeriod !== ALL_PERIODS
        ? metricPeriodId
        : `legacy:${report.report_period}`);
    return evaluateMetric(
      "health_insurance_rate",
      [reportToMetricEvaluationReport(report, periodId)],
      {
        period_id: periodId,
        scope: `village:${report.village_id}`,
        expected_village_ids: [report.village_id],
      },
    ).value;
  };

  // Get village name helper
  const getVillageName = (id: string) => {
    return new_villages.find((v) => v.id === id)?.name || id;
  };

  const handleExport = async (fileFormat: "xlsx" | "docx" | "pdf" = "xlsx") => {
    if (selectedPeriod === ALL_PERIODS) {
      alert("Vui lòng chọn một kỳ báo cáo cụ thể để xuất dữ liệu.");
      return;
    }

    const periodId = selectedPeriodOption.periodId;
    if (!periodId) {
      alert("Không xác định được mã kỳ báo cáo để xuất dữ liệu.");
      return;
    }
    if (effectiveVillageFilter !== "all" && fileFormat === "pdf") {
      alert(
        "Báo cáo PDF hiện chỉ hỗ trợ phạm vi toàn xã. Với một thôn, hãy chọn XLSX hoặc DOCX.",
      );
      return;
    }
    const route =
      effectiveVillageFilter !== "all"
        ? `/reports/village/${encodeURIComponent(effectiveVillageFilter)}/export/${fileFormat}?period_id=${encodeURIComponent(periodId)}`
        : `/reports/export/${fileFormat}?period_id=${encodeURIComponent(periodId)}`;
    try {
      const response = await apiFetch(route);
      if (!response.ok) throw new Error("Không thể xuất báo cáo.");
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      const periodPart = selectedPeriodLabel.replace(/[^0-9A-Za-zÀ-ỹ]+/g, "-");
      const scopePart =
        effectiveVillageFilter === "all"
          ? "toan-xa"
          : getVillageName(effectiveVillageFilter).replace(
              /[^0-9A-Za-zÀ-ỹ]+/g,
              "-",
            );
      // Keep the selected scope in the browser download name. This prevents a
      // village export from silently overwriting a commune-wide export.
      anchor.download = `bao-cao-${scopePart}-${periodPart}.${fileFormat}`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      alert(toUserFacingError(error, "Không thể xuất báo cáo."));
    }
  };

  return (
    <>
      <div
        className={`dashboard-data-workspace space-y-6 ${userRole === "lanh_dao" ? "leadership-dashboard" : ""}`}
      >
        <PageHeader
          eyebrow={
            userRole === "lanh_dao"
              ? "Dữ liệu phục vụ quyết định"
              : userRole === "admin_xa"
                ? "Báo cáo và phê duyệt"
                : "Dữ liệu địa bàn"
          }
          title={
            userRole === "can_bo_thon"
              ? "Dữ liệu của thôn"
              : userRole === "to_cnscd"
                ? "Dữ liệu các thôn được hỗ trợ"
               : userRole === "lanh_dao"
                 ? "Bức tranh điều hành toàn xã"
                 : "Tổng hợp số liệu"
          }
          description={
            userRole === "can_bo_thon"
              ? "Bạn chỉ xem và lập báo cáo cho thôn đã được phân công. Dữ liệu chưa có không được quy đổi thành số 0."
              : userRole === "to_cnscd"
                ? "Chỉ xem và hỗ trợ lập báo cáo cho các thôn được quản trị xã phân công. Dữ liệu chưa có không được quy đổi thành số 0."
              : userRole === "admin_xa"
                ? "Xã tạo kỳ, theo dõi việc nộp, duyệt và công bố theo quy trình. Dữ liệu chưa có không được quy đổi thành số 0."
                 : "Đi từ kết luận nổi bật tới thôn cần ưu tiên và báo cáo nguồn. Chỉ số liệu đã duyệt hoặc đã khóa mới được dùng; dữ liệu thiếu luôn được để trống."
          }
        />

        {userRole !== "dan" &&
          userRole !== "lanh_dao" &&
          localDrafts.length > 0 && (
            <SectionCard className="p-5 md:p-6 border-amber-200 bg-amber-50/40">
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    Bản nháp trên thiết bị
                  </h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Chỉ lưu trong trình duyệt này theo tài khoản hiện tại; chưa
                    gửi lên xã và không được tính vào số liệu tổng hợp.
                  </p>
                </div>
                <span className="shrink-0 rounded-full border border-amber-200 bg-white px-3 py-1 text-xs font-bold text-amber-800">
                  {localDrafts.length} bản nháp
                </span>
              </div>
              <div className="mt-4 grid gap-3">
                {localDrafts.map((draft) => (
                  <article
                    key={`local-${draft.id}`}
                    className="rounded-xl border border-amber-200 bg-white p-4 shadow-2xs"
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge
                            status={draft.pending_sync ? "pending" : "draft"}
                            label={
                              draft.pending_sync
                                ? "Chờ đồng bộ"
                                : "Bản nháp cục bộ"
                            }
                          />
                          <span className="text-xs font-semibold text-slate-500">
                            {getVillageName(draft.village_id)}
                          </span>
                        </div>
                        <h3 className="mt-2 font-bold text-slate-900">
                          {draft.report_period || "Chưa chọn kỳ báo cáo"}
                        </h3>
                        <p className="mt-1 text-xs text-slate-500">
                          Lưu gần nhất:{" "}
                          {draft.updated_at
                            ? new Date(draft.updated_at).toLocaleString("vi-VN")
                            : "Chưa xác định"}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          onClick={() => onEditReport(draft)}
                        >
                          <Edit className="h-4 w-4" /> Tiếp tục nhập
                        </Button>
                        <Button
                          type="button"
                          variant="danger"
                          onClick={() => onDeleteReport(draft, true)}
                        >
                          <Trash2 className="h-4 w-4" /> Xóa bản nháp
                        </Button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </SectionCard>
          )}

        <WorkSection
          index="01"
          title="Phạm vi báo cáo và xuất dữ liệu"
          description="Chọn kỳ, phạm vi thôn và định dạng xuất trước khi đọc số liệu; mọi khối bên dưới dùng chung đúng bộ lọc này."
          tone="focus"
          icon={<FileSpreadsheet />}
        >
          {/* Filters Toolbar */}
          <div className="filter-bar dashboard-filter-bar">
          <div className="dashboard-filter-bar__filters flex flex-wrap items-center gap-3 w-full md:w-auto">
            <div className="dashboard-filter-bar__field">
              <label
                htmlFor="dashboard-period-filter"
                className="dashboard-filter-bar__label block text-xs font-bold text-slate-600 mb-1.5"
              >
                Kỳ dữ liệu
              </label>
              <select
                id="dashboard-period-filter"
                value={selectedPeriod}
                onChange={(e) => setSelectedPeriod(e.target.value)}
                className="dashboard-filter-bar__select bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 font-semibold focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
              >
                {periodOptions.map((period) => (
                  <option key={period.value} value={period.value}>
                    {period.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="dashboard-filter-bar__field">
              <label
                htmlFor="dashboard-village-filter"
                className="dashboard-filter-bar__label block text-xs font-bold text-slate-600 mb-1.5"
              >
                {userRole === "to_cnscd" ? "Thôn được hỗ trợ" : "Phạm vi thôn"}
              </label>
              <select
                id="dashboard-village-filter"
                value={effectiveVillageFilter}
                onChange={(e) => setSelectedVillageFilter(e.target.value)}
                disabled={
                  (userRole === "can_bo_thon" || userRole === "to_cnscd") &&
                  selectableVillages.length <= 1
                }
                className="dashboard-filter-bar__select bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 font-semibold focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
              >
                {selectableVillages.length === 0 && (
                  <option value="">Chưa được phân công thôn</option>
                )}
                {selectableVillages.length > 1 && userRole !== "can_bo_thon" && (
                  <option value="all">
                    {userRole === "to_cnscd"
                      ? `Tất cả ${selectableVillages.length} thôn được hỗ trợ`
                      : `Tất cả ${selectableVillages.length} thôn`}
                  </option>
                )}
                {selectableVillages.map((village) => (
                  <option key={village.id} value={village.id}>
                    {village.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div
            className="dashboard-filter-bar__actions flex items-end gap-2 w-full md:w-auto"
            aria-label="Tải báo cáo"
          >
            {(userRole === "can_bo_thon" || userRole === "to_cnscd") && (
              <button
                onClick={() => onAddNewReport(selectedPeriodOption.periodId)}
                disabled={selectableVillages.length === 0}
                title={
                  selectableVillages.length === 0
                    ? "Cán bộ xã cần phân công ít nhất một thôn trước khi lập báo cáo."
                    : undefined
                }
                className="dashboard-filter-bar__new flex-1 md:flex-none bg-emerald-800 hover:bg-emerald-850 text-white font-bold text-xs px-4 py-2 rounded-lg shadow-xs flex items-center justify-center gap-1.5 transition-all active:scale-98 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="w-4 h-4" />
                <span>Lập báo cáo mới</span>
              </button>
            )}

            {!isCrossPeriodSnapshot && (
              <>
                {canExportSelectedScope && (
                  <>
                    <button
                      onClick={() => handleExport("xlsx")}
                      className="dashboard-export-button flex-1 md:flex-none"
                      aria-label="Tải báo cáo định dạng XLSX"
                    >
                      <FileSpreadsheet className="w-4 h-4" />
                      <span>Xuất XLSX</span>
                    </button>
                    <button
                      onClick={() => handleExport("docx")}
                      className="dashboard-export-button flex-1 md:flex-none"
                      aria-label="Tải báo cáo định dạng DOCX"
                    >
                      <FileText className="w-4 h-4" />
                      <span>Xuất DOCX</span>
                    </button>
                  </>
                )}
                {(userRole === "admin_xa" || userRole === "lanh_dao") &&
                  effectiveVillageFilter === "all" && (
                    <button
                      onClick={() => handleExport("pdf")}
                      className="dashboard-export-button flex-1 md:flex-none"
                      aria-label="Tải báo cáo định dạng PDF"
                    >
                      <FileText className="w-4 h-4" />
                      <span>Xuất PDF</span>
                    </button>
                  )}
              </>
            )}
          </div>
          </div>

          <DataScope
            period={selectedPeriodLabel}
            scope={
              !effectiveVillageFilter
                ? "Chưa được phân công thôn"
                : effectiveVillageFilter === "all"
                ? userRole === "to_cnscd"
                  ? `${selectableVillages.length} thôn được hỗ trợ`
                  : "Toàn bộ phạm vi được phép xem"
                : getVillageName(effectiveVillageFilter)
            }
            quality={
              expectedVillageCount > 0
                ? `${coveredVillageCount}/${expectedVillageCount} thôn có dữ liệu đã duyệt`
                : analyticsReports.length
                  ? `${analyticsReports.length} báo cáo đã duyệt`
                  : "Chưa có dữ liệu đã duyệt"
            }
            qualityLabel="Độ phủ"
          />

          {isCrossPeriodSnapshot && (
            <div
              className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950"
              role="status"
            >
              <strong className="block font-bold">
                Không tổng hợp: các thôn có thể thuộc kỳ khác nhau
              </strong>
              <p className="mt-1">
                Bảng báo cáo nguồn bên dưới vẫn hiển thị đúng một bản mới nhất
                của từng thôn cùng kỳ tương ứng. Hãy chọn một kỳ dữ liệu cụ thể
                để xem KPI, biểu đồ và so sánh trên cùng một kỳ.
              </p>
            </div>
          )}

          {!isCrossPeriodSnapshot &&
            expectedVillageCount > 0 &&
            !hasCompleteCoverage && (
              <div
                className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"
                role="status"
              >
                Kỳ báo cáo hiện có dữ liệu đã duyệt của {coveredVillageCount}/
                {expectedVillageCount} thôn. Các thẻ và biểu đồ bên dưới chỉ tổng
                hợp {coveredVillageCount} thôn đã duyệt, chưa đủ{" "}
                {userRole === "to_cnscd" || userRole === "can_bo_thon"
                  ? "phạm vi được phân công"
                  : "để đại diện cho toàn xã"}
                ; dữ liệu của các thôn còn lại vẫn được để trống.
              </div>
            )}
        </WorkSection>

        {!isCrossPeriodSnapshot && (
          <WorkSection
            index="02"
            title="Số liệu tổng quan"
            description="Bốn thẻ chỉ số cấp cao được gom riêng để quét nhanh quy mô, an sinh, y tế và văn hóa trong phạm vi đã chọn."
            tone="evidence"
            icon={<BarChart3 />}
          >
          {/* Grid: 4 Core KPIs Card */}
          <div className="leadership-metric-grid grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {/* KPI 1: Households & Pop */}
          <div className="leadership-metric-card bg-white rounded-xl border border-slate-100 p-5 shadow-2xs gov-card-accent-blue">
            <div className="flex justify-between items-start mb-3">
              <div className="p-2.5 bg-blue-50 text-blue-700 rounded-lg">
                <Users className="w-5 h-5" />
              </div>
              <span className="text-3xs font-bold text-blue-800 bg-blue-50 px-2 py-0.5 rounded-sm">
                QUY MÔ
              </span>
            </div>
            <h3 className="text-2xs font-semibold text-slate-400 uppercase tracking-wider">
              Hộ dân và nhân khẩu
            </h3>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-xl font-bold text-slate-800">
                {totalHouseholds !== null
                  ? formatViNumber(totalHouseholds)
                  : "—"}
              </span>
              <span className="text-xs text-slate-500">hộ</span>
            </div>
            <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
              <span>Tổng nhân khẩu:</span>
              <b className="text-slate-700 font-semibold">
                {totalPopulation !== null
                  ? `${formatViNumber(totalPopulation)} người`
                  : "Chưa có dữ liệu"}
              </b>
            </p>
          </div>

          {/* KPI 2: Poverty Structure */}
          <div className="leadership-metric-card bg-white rounded-xl border border-slate-100 p-5 shadow-2xs gov-card-accent-red">
            <div className="flex justify-between items-start mb-3">
              <div className="p-2.5 bg-rose-50 text-rose-600 rounded-lg">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <span className="text-3xs font-bold text-rose-800 bg-rose-50 px-2 py-0.5 rounded-sm">
                AN SINH
              </span>
            </div>
            <h3 className="text-2xs font-semibold text-slate-400 uppercase tracking-wider">
              Tỷ lệ hộ nghèo
            </h3>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-xl font-bold text-rose-600">
                {povertyRate !== null ? formatViPercent(povertyRate, 2) : "—"}
              </span>
              <span className="text-2xs text-rose-500">
                {povertyMetric?.numerator !== null
                  && povertyMetric?.numerator !== undefined
                  ? `(${formatViNumber(povertyMetric.numerator)} hộ)`
                  : "Chưa có dữ liệu"}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
              <span>Cận nghèo:</span>
              <b className="text-slate-700 font-semibold">
                {nearPovertyRate !== null
                  && nearPovertyMetric?.numerator !== null
                  && nearPovertyMetric?.numerator !== undefined
                  ? `${formatViPercent(nearPovertyRate, 2)} (${formatViNumber(nearPovertyMetric.numerator)} hộ)`
                  : "Chưa có dữ liệu"}
              </b>
            </p>
          </div>

          {/* KPI 3: BHYT Coverage */}
          <div className="leadership-metric-card bg-white rounded-xl border border-slate-100 p-5 shadow-2xs gov-card-accent-green">
            <div className="flex justify-between items-start mb-3">
              <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-lg">
                <HeartPulse className="w-5 h-5" />
              </div>
              <span className="text-3xs font-bold text-emerald-850 bg-emerald-50 px-2 py-0.5 rounded-sm">
                Y TẾ
              </span>
            </div>
            <h3 className="text-2xs font-semibold text-slate-400 uppercase tracking-wider">
              Tỷ lệ tham gia BHYT
            </h3>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-xl font-bold text-emerald-600">
                {bhytRate !== null ? formatViPercent(bhytRate, 1) : "—"}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              {bhytMetric?.numerator !== null
              && bhytMetric?.numerator !== undefined
              && bhytMetric.denominator !== null ? (
                <>
                  Đã có{" "}
                  <b className="text-slate-700 font-semibold">
                    {formatViNumber(bhytMetric.numerator)} /{" "}
                    {formatViNumber(bhytMetric.denominator)}
                  </b>{" "}
                  người tham gia
                </>
              ) : (
                "Chưa có dữ liệu"
              )}
            </p>
          </div>

          {/* KPI 4: Cultural achievements */}
          <div className="leadership-metric-card bg-white rounded-xl border border-slate-100 p-5 shadow-2xs gov-card-accent-gold">
            <div className="flex justify-between items-start mb-3">
              <div className="p-2.5 bg-amber-50 text-amber-600 rounded-lg">
                <Award className="w-5 h-5" />
              </div>
              <span className="text-3xs font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-sm">
                VĂN HÓA
              </span>
            </div>
            <h3 className="text-2xs font-semibold text-slate-400 uppercase tracking-wider">
              Tỷ lệ hộ gia đình văn hóa
            </h3>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-xl font-bold text-amber-600">
                {culturalFamilyRate !== null
                  ? formatViPercent(culturalFamilyRate, 1)
                  : "—"}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              {culturalFamilyMetric?.numerator !== null
              && culturalFamilyMetric?.numerator !== undefined
              && culturalFamilyMetric.denominator !== null ? (
                <>
                  Đạt chuẩn:{" "}
                  <b className="text-slate-700 font-semibold">
                    {formatViNumber(culturalFamilyMetric.numerator)} /{" "}
                    {formatViNumber(culturalFamilyMetric.denominator)}
                  </b>{" "}
                  hộ dân
                </>
              ) : (
                "Chưa có dữ liệu"
              )}
            </p>
          </div>
          </div>

          {/* Bento Grid: Custom SVG Graphs & Tech Progress */}
          <div
            className="hidden grid-cols-1 xl:grid-cols-12 gap-6"
            aria-hidden="true"
          >
          {/* Left Bento: Population distribution bar graph */}
          <div className="xl:col-span-8 bg-white rounded-xl border border-slate-100 p-6 shadow-2xs flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-emerald-600" />
                  <h3 className="font-bold text-slate-800 text-sm">
                    Số hộ dân và nhân khẩu theo thôn
                  </h3>
                </div>
                <span className="text-3xs font-mono text-slate-400">
                  Đơn vị: Người / Hộ
                </span>
              </div>

              {/* A chart is only useful when its source slice contains reports. */}
              {filteredReports.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 bg-slate-25">
                  <div className="empty-state">
                    <BarChart3 aria-hidden="true" />
                    <h3>Chưa có dữ liệu để lập biểu đồ</h3>
                    <p>
                      Hãy chọn kỳ hoặc thôn có báo cáo, hoặc tạo báo cáo mới. Hệ
                      thống không thay dữ liệu thiếu bằng số 0.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="w-full h-64 relative bg-slate-25 rounded-lg border border-slate-100/60 p-4 overflow-x-auto overflow-y-hidden custom-scrollbar">
                    {(() => {
                      const numReports = filteredReports.length;
                      const minSpacing = 60;
                      // dynamic chart width
                      const requiredWidth = Math.max(
                        600,
                        70 + numReports * minSpacing + 50,
                      );
                      const chartHeight = 240;

                      return (
                        <svg
                          viewBox={`0 0 ${requiredWidth} ${chartHeight}`}
                          className="h-full"
                          style={{ minWidth: `${requiredWidth}px` }}
                        >
                          {chartScale.ticks.map((tick, index) => {
                            const y = 30 + index * 37.5;
                            return (
                              <g key={tick}>
                                <line
                                  x1="50"
                                  y1={y}
                                  x2={requiredWidth - 20}
                                  y2={y}
                                  stroke={
                                    index === chartScale.ticks.length - 1
                                      ? "#e2e8f0"
                                      : "#f1f5f9"
                                  }
                                  strokeWidth="1"
                                />
                                <text
                                  x="40"
                                  y={y + 4}
                                  style={{ fontSize: "9px" }}
                                  className="font-mono fill-slate-500 font-bold"
                                  textAnchor="end"
                                >
                                  {tick.toLocaleString("vi-VN")}
                                </text>
                              </g>
                            );
                          })}

                          {/* Render bars for the filtered reports */}
                          {filteredReports.map((report, idx) => {
                            const xBase = 70 + idx * minSpacing;
                            const popHeight = Math.min(
                              150,
                              (report.CT02 / chartScale.max) * 150,
                            );
                            const hhHeight = Math.min(
                              150,
                              (report.CT01 / chartScale.max) * 150,
                            );

                            return (
                              <g
                                key={report.id}
                                className="group cursor-pointer"
                              >
                                {/* Tooltip background on hover */}
                                <rect
                                  x={xBase - 15}
                                  y="10"
                                  width="48"
                                  height="180"
                                  fill="transparent"
                                  className="hover:fill-slate-500/10 transition-colors rounded"
                                />

                                {/* Population Bar (Emerald/Green to match Legend) */}
                                <rect
                                  x={xBase}
                                  y={180 - popHeight}
                                  width="10"
                                  height={popHeight}
                                  fill="#059669"
                                  rx="2"
                                  className="transition-all duration-300 group-hover:opacity-80"
                                />

                                {/* Household Bar (Slate to match Legend) */}
                                <rect
                                  x={xBase + 12}
                                  y={180 - hhHeight}
                                  width="10"
                                  height={hhHeight}
                                  fill="#64748b"
                                  rx="2"
                                  className="transition-all duration-300 group-hover:opacity-80"
                                />

                                {/* X-Axis labels - Inline styled to prevent overlap */}
                                <text
                                  x={xBase + 11}
                                  y="200"
                                  style={{ fontSize: "9px", fontWeight: 700 }}
                                  className="fill-slate-600 group-hover:fill-emerald-850 transition-colors"
                                  textAnchor="middle"
                                  transform={`rotate(-25 ${xBase + 11} 200)`}
                                >
                                  {getVillageName(report.village_id).replace(
                                    "Thôn ",
                                    "",
                                  )}
                                </text>

                                {/* Hover stats tooltip popup */}
                                <title>{`Thôn: ${getVillageName(report.village_id)}\nNhân khẩu: ${report.CT02} người\nHộ dân: ${report.CT01} hộ`}</title>
                              </g>
                            );
                          })}
                        </svg>
                      );
                    })()}
                  </div>

                  {/* Chart Legend */}
                  <div className="flex gap-4 mt-3 pt-3 border-t border-slate-50 text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="w-3 h-3 bg-emerald-600 rounded-xs"></span>
                      <span className="text-slate-500 font-medium">
                        Tổng số nhân khẩu (CT02)
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-3 h-3 bg-slate-600 rounded-xs"></span>
                      <span className="text-slate-500 font-medium">
                        Tổng số hộ dân (CT01)
                      </span>
                    </div>
                  </div>
                  <button
                    ref={chartTriggerRef}
                    onClick={() => setShowChartModal(true)}
                    className="mt-3 flex items-center gap-1.5 text-xs text-emerald-700 font-bold hover:text-emerald-900 transition-colors self-end"
                  >
                    <Maximize2 className="w-3.5 h-3.5" />
                    Mở biểu đồ toàn màn hình
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Right Bento: Digital & Social Progress indicators */}
          <div className="xl:col-span-4 bg-white rounded-xl border border-slate-100 p-6 shadow-2xs flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Cpu className="w-5 h-5 text-emerald-600" />
                <h3 className="font-bold text-slate-800 text-sm">
                  Chuyển đổi số và công nghệ
                </h3>
              </div>

              <div className="space-y-4">
                {/* Metric 1: Tech community members */}
                <div className="bg-slate-25 p-3.5 rounded-lg border border-slate-100/50">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-500 font-medium">
                      Thành viên Tổ công nghệ số cộng đồng (CT12)
                    </span>
                    <span className="font-bold text-emerald-700 text-right">
                      {totalDigitalTeam === null
                        ? "—"
                        : `${totalDigitalTeam} người`}
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                    <div
                      className="bg-emerald-600 h-1.5 rounded-full"
                      style={{
                        width: `${totalDigitalTeam === null ? 0 : Math.min(100, (totalDigitalTeam / 100) * 100)}%`,
                      }}
                    ></div>
                  </div>
                </div>

                {/* Metric 2: Online public services instruction */}
                <div className="bg-slate-25 p-3.5 rounded-lg border border-slate-100/50">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-500 font-medium">
                      Số người được hướng dẫn sử dụng dịch vụ công trực tuyến
                      trong kỳ (CT13)
                    </span>
                    <span className="font-bold text-emerald-700 text-right">
                      {totalOnlineServiceGuided === null
                        ? "—"
                        : `${totalOnlineServiceGuided} người`}
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                    <div
                      className="bg-emerald-500 h-1.5 rounded-full"
                      style={{
                        width: `${totalOnlineServiceGuided === null ? 0 : Math.min(100, (totalOnlineServiceGuided / 500) * 100)}%`,
                      }}
                    ></div>
                  </div>
                </div>

                {/* Metric 3: Revolutionary Contributors & Social Protection */}
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div className="bg-slate-25 p-3 rounded-lg border border-slate-100/50 text-center">
                    <span className="block text-3xs text-slate-500 font-medium uppercase tracking-wider mb-1">
                      Người có công với cách mạng đang được quản lý (CT05)
                    </span>
                    <b className="text-sm font-bold text-slate-700">
                      {totalRevolutionContributors === null
                        ? "—"
                        : `${totalRevolutionContributors} người`}
                    </b>
                  </div>
                  <div className="bg-slate-25 p-3 rounded-lg border border-slate-100/50 text-center">
                    <span className="block text-3xs text-slate-500 font-medium uppercase tracking-wider mb-1">
                      Bảo trợ xã hội (CT06)
                    </span>
                    <b className="text-sm font-bold text-slate-700">
                      {totalSocialProtection === null
                        ? "—"
                        : `${totalSocialProtection} người`}
                    </b>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-50 flex items-center justify-between text-2xs">
              <span className="text-slate-400 font-medium">
                Vụ bạo lực gia đình ghi nhận (CT14):
              </span>
              <span
                className={`px-2 py-0.5 rounded font-bold ${totalDomesticViolence !== null && totalDomesticViolence > 0 ? "bg-rose-100 text-rose-800" : "bg-emerald-100 text-emerald-800"}`}
              >
                {totalDomesticViolence === null
                  ? "—"
                  : `${totalDomesticViolence} vụ`}
              </span>
            </div>
          </div>
          </div>
          </WorkSection>
        )}

        {!isCrossPeriodSnapshot && (
          <WorkSection
            index="03"
            title={
              usesSingleVillageInsights
                ? "Theo dõi biến động của thôn"
                : "Phân tích ưu tiên theo thôn"
            }
            description={
              usesSingleVillageInsights
                ? "Theo dõi trạng thái của kỳ đang chọn và biến động qua các kỳ trong đúng phạm vi một thôn."
                : "Tách các biểu đồ so sánh và tín hiệu cần chú ý khỏi số liệu tổng quan; đây là vùng hỗ trợ rà soát, không phải bảng xếp hạng."
            }
            tone="support"
            icon={<TrendingUp />}
          >
          {usesSingleVillageInsights ? (
            <DashboardInsightCharts
              reports={analyticsReports}
              historicalReports={insightHistoryReports}
              reportPeriods={reportPeriods}
              villageName={getVillageName}
              singleVillage
              selectedPeriodLabel={selectedPeriodLabel}
            />
          ) : (
            <details className="dashboard-insight-disclosure" open>
              <summary>
                <span>
                  <strong>Bộ biểu đồ phân tích chi tiết</strong>
                  <small>
                    So sánh độ phủ, cơ cấu và tín hiệu ưu tiên giữa các thôn
                    trong đúng kỳ đang chọn.
                  </small>
                </span>
              </summary>
              <div className="dashboard-insight-disclosure__body">
                <DashboardInsightCharts
                  reports={analyticsReports}
                  historicalReports={insightHistoryReports}
                  reportPeriods={reportPeriods}
                  villageName={getVillageName}
                  singleVillage={false}
                  selectedPeriodLabel={selectedPeriodLabel}
                />
              </div>
            </details>
          )}
          </WorkSection>
        )}

        {/* Section: Interactive Submissions Log and Details Table */}
        <WorkSection
          index="04"
          title="Báo cáo nguồn và hành động nghiệp vụ"
          description="Danh sách báo cáo gốc được đặt trong vùng riêng để cán bộ đối chiếu trạng thái và các thao tác duyệt, khóa hoặc công bố."
          tone="tasks"
          icon={<FileText />}
        >
          <div className="bg-white rounded-xl border border-slate-100 shadow-2xs p-6">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-4">
            <div>
              <h3 className="font-bold text-slate-800 text-sm flex items-center gap-1.5">
                <FileText className="w-5 h-5 text-emerald-600" />
                <span>Danh sách báo cáo của các thôn</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Danh sách báo cáo thuộc phạm vi quyền truy cập và bộ lọc hiện
                tại.
              </p>
            </div>
            <span className="text-xs text-slate-400 font-semibold">
              {detailReports.length} báo cáo
            </span>
          </div>

          {detailReports.length === 0 ? (
            <div className="text-center py-12 border border-dashed border-slate-200 rounded-xl">
              <FileText className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-xs text-slate-500">
                Chưa có bản báo cáo nào được ghi nhận khớp với bộ lọc.
              </p>
              {(userRole === "can_bo_thon" || userRole === "to_cnscd") && (
                <button
                  onClick={() => onAddNewReport(selectedPeriodOption.periodId)}
                  className="mt-3 text-xs text-emerald-600 hover:text-emerald-800 font-bold"
                >
                  Khai báo ngay
                </button>
              )}
            </div>
          ) : (
            <div
              className="table-scroll-region overflow-x-auto focus-visible:ring-2 focus-visible:ring-emerald-700"
              tabIndex={0}
              role="region"
              aria-label="Danh sách báo cáo của các thôn"
            >
              <span className="sticky left-3 z-10 my-2 ml-3 inline-flex rounded-full bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-900 lg:hidden">
                Vuốt ngang để xem thêm →
              </span>
              <table className="w-full text-left text-xs text-slate-600">
                <caption className="sr-only">
                  Danh sách báo cáo thuộc phạm vi và bộ lọc hiện tại
                </caption>
                <thead className="bg-slate-50 text-slate-500 uppercase font-bold tracking-wider text-4xs border-b border-slate-100">
                  <tr>
                    <th scope="col" className="py-3 px-4">Thôn báo cáo</th>
                    <th scope="col" className="py-3 px-3">Kỳ báo cáo</th>
                    <th scope="col" className="py-3 px-3">Hộ dân (CT01)</th>
                    <th scope="col" className="py-3 px-3">Nhân khẩu (CT02)</th>
                    <th scope="col" className="py-3 px-3">Hộ nghèo (CT03)</th>
                    <th scope="col" className="py-3 px-3">BHYT (CT11)</th>
                    <th scope="col" className="py-3 px-3">Trạng thái</th>
                    {userRole !== "dan" && userRole !== "lanh_dao" && (
                      <th scope="col" className="py-3 px-4 text-right">Thao tác</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {detailReports.map((report) => {
                    const bhytRowRate = reportBhytRate(report);
                    return (
                    <tr
                      key={report.id}
                      className="hover:bg-slate-25/50 transition-colors"
                    >
                      <th scope="row" className="py-3.5 px-4 font-bold text-slate-800">
                        {getVillageName(report.village_id)}
                      </th>
                      <td className="py-3.5 px-3 font-semibold text-slate-600">
                        {report.report_period}
                      </td>
                      <td className="py-3.5 px-3 font-mono">{formatViNumber(report.CT01)}</td>
                      <td className="py-3.5 px-3 font-mono">{formatViNumber(report.CT02)}</td>
                      <td className="py-3.5 px-3 font-mono text-rose-600 font-semibold">
                        {formatViNumber(report.CT03)}
                      </td>
                      <td className="py-3.5 px-3 font-mono text-emerald-600 font-semibold">
                        {bhytRowRate !== null
                          ? formatViPercent(bhytRowRate, 0)
                          : "—"}
                      </td>
                      <td className="py-3.5 px-3">
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 rounded text-4xs font-bold uppercase ${
                            workflowStatusOf(report) === "approved"
                              ? "bg-emerald-100 text-emerald-800"
                              : workflowStatusOf(report) === "submitted"
                                ? "bg-emerald-100 text-emerald-800"
                                : workflowStatusOf(report) === "needs_revision"
                                  ? "bg-amber-50 text-amber-750 border border-amber-200"
                                  : workflowStatusOf(report) === "locked"
                                    ? "bg-slate-800 text-white"
                                    : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {workflowStatusOf(report) === "approved"
                            ? "Đã duyệt"
                            : workflowStatusOf(report) === "submitted"
                              ? "Đã nộp"
                              : workflowStatusOf(report) === "needs_revision"
                                ? "Cần bổ sung"
                                : workflowStatusOf(report) === "locked"
                                  ? "Đã khóa"
                                  : "Nháp"}
                        </span>
                      </td>
                      {(userRole === "admin_xa" ||
                        userRole === "can_bo_thon" ||
                        userRole === "to_cnscd") && (
                        <td className="py-3.5 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {report.publication_status === "published" && (
                              <span className="text-2xs font-semibold text-emerald-700">
                                Đã công bố
                              </span>
                            )}
                            {userRole === "admin_xa" &&
                              workflowStatusOf(report) === "submitted" &&
                              onApproveReport && (
                                <button
                                  onClick={() => onApproveReport(report)}
                                  aria-label={`Duyệt báo cáo ${report.report_period}`}
                                  className="inline-flex min-h-11 min-w-11 items-center justify-center text-slate-500 hover:text-emerald-700 hover:bg-slate-50 rounded-lg transition-colors"
                                  title="Duyệt báo cáo"
                                >
                                  <CheckCircle className="w-3.5 h-3.5" />
                                </button>
                              )}
                            {userRole === "admin_xa" &&
                              workflowStatusOf(report) === "approved" &&
                              report.publication_status === "private" &&
                              onLockReport && (
                                <button
                                  onClick={() => onLockReport(report)}
                                  aria-label={`Khóa báo cáo ${report.report_period}`}
                                  className="inline-flex min-h-11 min-w-11 items-center justify-center text-slate-500 hover:text-amber-700 hover:bg-slate-50 rounded-lg transition-colors"
                                  title="Khóa báo cáo (không cho sửa)"
                                >
                                  <Lock className="w-3.5 h-3.5" />
                                </button>
                              )}
                            {userRole === "admin_xa" &&
                              report.publication_status === "private" &&
                              (workflowStatusOf(report) === "approved" ||
                                workflowStatusOf(report) === "locked") &&
                              onPublishReport && (
                                <button
                                  onClick={() => onPublishReport(report)}
                                  aria-label={`Công bố báo cáo ${report.report_period}`}
                                  className="inline-flex min-h-11 min-w-11 items-center justify-center text-slate-500 hover:text-sky-700 hover:bg-slate-50 rounded-lg transition-colors"
                                  title="Công bố báo cáo"
                                >
                                  <Globe2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            {(userRole === "can_bo_thon" ||
                              userRole === "to_cnscd") &&
                              (workflowStatusOf(report) === "draft" ||
                                workflowStatusOf(report) ===
                                  "needs_revision") && (
                                <button
                                  onClick={() => onEditReport(report)}
                                  aria-label={`Chỉnh sửa báo cáo ${report.report_period}`}
                                  className="inline-flex min-h-11 min-w-11 items-center justify-center text-slate-500 hover:text-emerald-700 hover:bg-slate-50 rounded-lg transition-colors"
                                  title="Chỉnh sửa số liệu"
                                >
                                  <Edit className="w-3.5 h-3.5" />
                                </button>
                              )}
                            {((userRole === "admin_xa" &&
                              workflowStatusOf(report) === "draft") ||
                              ((userRole === "can_bo_thon" ||
                                userRole === "to_cnscd") &&
                                workflowStatusOf(report) === "draft")) && (
                              <button
                                onClick={() => onDeleteReport(report)}
                                aria-label={`Xóa báo cáo ${report.report_period}`}
                                className="inline-flex min-h-11 min-w-11 items-center justify-center text-slate-500 hover:text-rose-700 hover:bg-slate-50 rounded-lg transition-colors"
                                title="Xóa báo cáo"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          </div>
        </WorkSection>
      </div>

      {/* Chart Modal Fullscreen */}
      {showChartModal && !isCrossPeriodSnapshot && (
        <div
          className="fixed inset-0 z-[1100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setShowChartModal(false)}
        >
          <div
            ref={chartDialogRef}
            className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90dvh] flex flex-col overflow-hidden"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dashboard-chart-title"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-emerald-600" />
                <h3
                  id="dashboard-chart-title"
                  className="font-bold text-slate-800 text-sm"
                >
                  Số hộ dân và nhân khẩu theo thôn
                </h3>
                {selectedPeriod !== ALL_PERIODS && (
                  <span className="text-xs text-slate-500 font-medium">
                    — {selectedPeriodLabel}
                  </span>
                )}
              </div>
              <button
                ref={chartCloseRef}
                type="button"
                aria-label="Đóng biểu đồ toàn màn hình"
                onClick={() => setShowChartModal(false)}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Chart Body */}
            <div className="flex-1 overflow-auto p-6">
              <div className="w-full h-96 relative bg-slate-25 rounded-xl border border-slate-100 p-4 overflow-x-auto overflow-y-hidden custom-scrollbar">
                {(() => {
                  const numReports = filteredReports.length;
                  const minSpacing = 80;
                  const requiredWidth = Math.max(
                    700,
                    80 + numReports * minSpacing + 60,
                  );
                  const chartHeight = 300;

                  return (
                    <svg
                      viewBox={`0 0 ${requiredWidth} ${chartHeight}`}
                      className="h-full"
                      style={{ minWidth: `${requiredWidth}px` }}
                    >
                      {chartScale.ticks.map((tick, index) => {
                        const y = 70 + index * 52.5;
                        return (
                          <g key={tick}>
                            <line
                              x1="60"
                              y1={y}
                              x2={requiredWidth - 20}
                              y2={y}
                              stroke="#f1f5f9"
                              strokeWidth="1"
                            />
                            <text
                              x="50"
                              y={y + 4}
                              style={{ fontSize: "10px" }}
                              className="font-mono fill-slate-400 font-bold"
                              textAnchor="end"
                            >
                              {tick.toLocaleString("vi-VN")}
                            </text>
                          </g>
                        );
                      })}

                      {filteredReports.map((report, idx) => {
                        const xBase = 80 + idx * minSpacing;
                        const popHeight = Math.min(
                          210,
                          (report.CT02 / chartScale.max) * 210,
                        );
                        const hhHeight = Math.min(
                          210,
                          (report.CT01 / chartScale.max) * 210,
                        );
                        return (
                          <g key={report.id} className="group cursor-pointer">
                            <rect
                              x={xBase - 20}
                              y="10"
                              width="66"
                              height="285"
                              fill="transparent"
                              className="hover:fill-slate-500/5 transition-colors"
                            />
                            <rect
                              x={xBase}
                              y={280 - popHeight}
                              width="14"
                              height={popHeight}
                              fill="#059669"
                              rx="3"
                              className="transition-all duration-300 group-hover:opacity-75"
                            />
                            <rect
                              x={xBase + 16}
                              y={280 - hhHeight}
                              width="14"
                              height={hhHeight}
                              fill="#64748b"
                              rx="3"
                              className="transition-all duration-300 group-hover:opacity-75"
                            />
                            {/* Population value */}
                            <text
                              x={xBase + 7}
                              y={280 - popHeight - 5}
                              style={{ fontSize: "9px", fontWeight: 700 }}
                              className="fill-emerald-700"
                              textAnchor="middle"
                            >
                              {report.CT02}
                            </text>
                            {/* HH value */}
                            <text
                              x={xBase + 23}
                              y={280 - hhHeight - 5}
                              style={{ fontSize: "9px", fontWeight: 700 }}
                              className="fill-slate-500"
                              textAnchor="middle"
                            >
                              {report.CT01}
                            </text>
                            <text
                              x={xBase + 14}
                              y={297}
                              style={{ fontSize: "10px", fontWeight: 700 }}
                              className="fill-slate-600 group-hover:fill-emerald-700 transition-colors"
                              textAnchor="middle"
                              transform={`rotate(-30 ${xBase + 14} 297)`}
                            >
                              {getVillageName(report.village_id).replace(
                                "Thôn ",
                                "",
                              )}
                            </text>
                            <title>{`Thôn: ${getVillageName(report.village_id)}\nNhân khẩu: ${report.CT02} người\nHộ dân: ${report.CT01} hộ`}</title>
                          </g>
                        );
                      })}
                    </svg>
                  );
                })()}
                {filteredReports.length === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-400 font-medium">
                    Chưa có dữ liệu cho kỳ báo cáo này.
                  </div>
                )}
              </div>
              {/* Legend */}
              <div className="flex gap-6 mt-4 text-sm">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 bg-emerald-600 rounded"></span>
                  <span className="text-slate-600 font-medium">
                    Nhân khẩu (CT02)
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 bg-slate-600 rounded"></span>
                  <span className="text-slate-600 font-medium">
                    Hộ dân (CT01)
                  </span>
                </div>
                <span className="ml-auto text-xs text-slate-500">
                  Số liệu chi tiết có trong bảng báo cáo
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
