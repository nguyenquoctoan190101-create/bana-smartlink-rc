import { useEffect, useRef, useState } from "react";
import { 
  Award, 
  Globe, 
  Database, 
  Calendar, 
  HelpCircle, 
  Loader2, 
  AlertCircle 
} from "lucide-react";
import { apiFetch, toUserFacingError } from "../lib/apiClient";
import { useReportPeriods } from "../lib/useReportPeriods";
import { Button, WorkSection } from "./ui";
import "./PolicyScorecard.css";

interface PolicyMetric {
  numerator: number;
  denominator: number;
  percent: number;
}

interface ScorecardData {
  period_id: string;
  period_name: string;
  electronic_profile_rate: PolicyMetric;
  once_only_score: PolicyMetric;
  interpretation: string;
}

export default function PolicyScorecard({
  preferredPeriodId = "",
}: {
  onBackToDashboard?: () => void;
  preferredPeriodId?: string;
}) {
  const {
    periods: availablePeriods,
    isLoading: periodsLoading,
    error: periodsError,
  } = useReportPeriods();
  const [selectedPeriod, setSelectedPeriod] = useState<string>("");
  const userSelectedPeriodRef = useRef(false);
  const [data, setData] = useState<ScorecardData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Safe helper functions to prevent rendering of raw objects and avoid crashing
  const getPercent = (metric: any): number => {
    if (!metric) return 0;
    if (typeof metric === 'object' && typeof metric.percent === 'number') return metric.percent;
    if (typeof metric === 'number') return metric;
    return 0;
  };

  const getNumerator = (metric: any): number => {
    if (!metric) return 0;
    if (typeof metric === 'object' && typeof metric.numerator === 'number') return metric.numerator;
    return 0;
  };

  const getDenominator = (metric: any): number => {
    if (!metric) return 0;
    if (typeof metric === 'object' && typeof metric.denominator === 'number') return metric.denominator;
    return 0;
  };

  const fetchScorecard = async (period: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch(`/api/policy-scorecard?period_id=${encodeURIComponent(period)}`);
      if (!response.ok) {
        throw new Error("Không thể kết nối máy chủ hoặc lấy dữ liệu chỉ số.");
      }
      const resData: ScorecardData = await response.json();
      setData(resData);
    } catch (err) {
      console.error("Lỗi tải thông tin theo dõi kế hoạch:", err);
      setError(toUserFacingError(err, "Đã xảy ra lỗi hệ thống."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedPeriod) void fetchScorecard(selectedPeriod);
  }, [selectedPeriod]);

  useEffect(() => {
    const preferredIsAvailable = availablePeriods.some(
      (period) => period.id === preferredPeriodId,
    );
    if (!userSelectedPeriodRef.current && preferredIsAvailable) {
      setSelectedPeriod(preferredPeriodId);
      return;
    }
    if (!selectedPeriod && availablePeriods.length > 0) {
      setSelectedPeriod(availablePeriods[0].id);
    }
  }, [availablePeriods, preferredPeriodId, selectedPeriod]);

  const electronicDenominator = getDenominator(data?.electronic_profile_rate);
  const inheritedDenominator = getDenominator(data?.once_only_score);
  const hasElectronicRate = electronicDenominator > 0;
  const hasInheritedRate = inheritedDenominator > 0;
  const summary = data
    ? `Kỳ ${data.period_name}: ${
        hasElectronicRate
          ? `${Math.round(getPercent(data.electronic_profile_rate))}% báo cáo nộp điện tử`
          : "chưa có báo cáo đủ điều kiện để tính tỷ lệ báo cáo điện tử"
      }; ${
        hasInheritedRate
          ? `tỷ lệ dữ liệu được kế thừa ${Math.round(getPercent(data.once_only_score))}%`
          : "chưa có trường dữ liệu đủ điều kiện để tính tỷ lệ được kế thừa"
      }.`
    : "";

  return (
    <div className="policy-scorecard-screen bg-white rounded-2xl border border-slate-150 p-5 sm:p-6 shadow-xs max-w-6xl mx-auto space-y-5 animate-fade-in">
      
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-emerald-700 font-bold text-xs uppercase tracking-wider">
            <Award className="w-4 h-4" />
            <span>Theo dõi thực hiện kế hoạch</span>
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">
            Tiến độ sử dụng dữ liệu số
          </h1>
          <p className="text-xs text-slate-500 font-medium">
            Chỉ số tham khảo nội bộ, được tính từ báo cáo trong kỳ đã chọn
          </p>
        </div>

      </div>

      <WorkSection
        index="01"
        title="Chọn phạm vi theo dõi"
        description="Chọn một kỳ báo cáo trước khi đọc kết quả; toàn bộ chỉ số phía dưới dùng chung đúng phạm vi này."
        tone="focus"
        icon={<Calendar />}
      >
        <div className="bg-slate-50/70 rounded-xl p-4 border border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="bg-white p-2 rounded-lg border border-slate-200 text-emerald-700 shadow-3xs">
              <Calendar className="w-4 h-4" />
            </div>
            <div>
              <label className="block text-3xs font-extrabold text-slate-400 uppercase tracking-wider">Kỳ báo cáo</label>
              <span className="text-xs font-bold text-slate-700">Dữ liệu theo kỳ báo cáo đã chọn</span>
            </div>
          </div>

          <label className="w-full text-sm font-bold text-slate-700 sm:max-w-sm">
            <span className="sr-only">Chọn kỳ báo cáo</span>
            <select
              className="w-full bg-white"
              value={selectedPeriod}
              onChange={(event) => {
                userSelectedPeriodRef.current = true;
                setSelectedPeriod(event.target.value);
              }}
            >
              {availablePeriods.map((period) => (
                <option key={period.id} value={period.id}>
                  {period.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </WorkSection>

      <WorkSection
        index="02"
        title="Kết quả và ý nghĩa theo dõi"
        description="Tách phần kết luận, từng chỉ số và cách diễn giải khỏi khu vực chọn kỳ để tránh đọc nhầm phạm vi."
        tone="evidence"
        icon={<Award />}
      >
        {/* Loading state rendering */}
        {periodsLoading ? (
          <div className="h-64 flex flex-col items-center justify-center text-slate-400">
            <Loader2 className="w-8 h-8 animate-spin text-emerald-600 mb-2" />
            <p className="text-xs font-bold">Đang tải danh sách kỳ báo cáo...</p>
          </div>
        ) : periodsError ? (
          <div className="bg-red-50/50 border border-red-150 rounded-xl p-5 flex items-start gap-3" role="alert">
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="text-xs font-bold text-red-900">Chưa tải được kỳ báo cáo</h4>
              <p className="text-4xs text-red-700 font-medium leading-relaxed">{periodsError}</p>
            </div>
          </div>
        ) : availablePeriods.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-600" role="status">
            Chưa có kỳ báo cáo để tính chỉ số theo dõi.
          </div>
        ) : loading ? (
          <div className="h-64 flex flex-col items-center justify-center text-slate-400">
            <Loader2 className="w-8 h-8 animate-spin text-emerald-600 mb-2" />
            <p className="text-xs font-bold">Đang tổng hợp chỉ số từ dữ liệu báo cáo...</p>
          </div>
        ) : error ? (
          <div className="bg-red-50/50 border border-red-150 rounded-xl p-5 flex items-start gap-3" role="alert">
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="text-xs font-bold text-red-900">Tính toán chỉ số thất bại</h4>
              <p className="text-4xs text-red-700 font-medium leading-relaxed">{error}</p>
              <Button
                type="button"
                variant="secondary"
                className="mt-3"
                onClick={() => selectedPeriod && void fetchScorecard(selectedPeriod)}
              >
                Thử tải lại
              </Button>
            </div>
          </div>
        ) : data ? (
          <div className="space-y-8">
          
          {/* Output text as requested */}
          <div className="bg-emerald-50/40 border border-emerald-100 rounded-xl p-4 shadow-3xs">
            <h3 className="text-3xs font-black uppercase text-emerald-800 tracking-wider mb-1.5">Tóm tắt kết quả theo dõi</h3>
            <p className="text-sm font-bold text-emerald-950 leading-snug">
              {summary}
            </p>
          </div>

          {/* Indicators list */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* Indicator 1: Tỷ lệ hồ sơ điện tử */}
            <div className="border border-slate-150 rounded-2xl p-6 hover:shadow-xs transition-all flex flex-col justify-between space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="bg-emerald-50 text-emerald-800 text-3xs font-extrabold px-2 py-0.5 rounded-full border border-emerald-100 uppercase tracking-wider">Chỉ số 1</span>
                  <div className="text-slate-400 hover:text-slate-500 cursor-help" title="Số báo cáo nộp bằng biểu mẫu trực tuyến chia cho tổng số báo cáo đã nộp trong kỳ.">
                    <Globe className="w-4 h-4 text-emerald-600" />
                  </div>
                </div>
                <h3 className="text-base font-black text-slate-900 leading-tight">Tỷ lệ báo cáo điện tử</h3>
                <p className="text-4xs text-slate-500 font-medium leading-relaxed">
                  Tỷ lệ báo cáo được lập và gửi trực tiếp trên hệ thống so với tổng số báo cáo đã nộp trong kỳ.
                </p>
              </div>

              <div className="space-y-2 pt-2">
                <div className="flex justify-between items-baseline">
                  <span className="text-3xl font-black text-slate-900 tracking-tight">
                    {hasElectronicRate
                      ? `${Math.round(getPercent(data?.electronic_profile_rate))}%`
                      : "—"}
                  </span>
                  <span className="text-4xs text-slate-400 font-bold">
                    {hasElectronicRate
                      ? `${getNumerator(data?.electronic_profile_rate)}/${electronicDenominator} báo cáo nộp điện tử`
                      : "Chưa có báo cáo để tính"}
                  </span>
                </div>
                
                {/* Custom Progress bar */}
                <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden border border-slate-200/50">
                  <div 
                    className="bg-emerald-500 h-full rounded-full transition-all duration-700 ease-out"
                    style={{ width: `${getPercent(data?.electronic_profile_rate)}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Indicator 2: Tỷ lệ dữ liệu được kế thừa */}
            <div className="border border-slate-150 rounded-2xl p-6 hover:shadow-xs transition-all flex flex-col justify-between space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="bg-emerald-50 text-emerald-800 text-3xs font-extrabold px-2 py-0.5 rounded-full border border-emerald-100 uppercase tracking-wider">Chỉ số 2</span>
                  <div className="text-slate-400 hover:text-slate-500 cursor-help" title="Số trường được kế thừa từ kỳ trước và dữ liệu nền tảng chia cho tổng số trường cần nhập.">
                    <Database className="w-4 h-4 text-emerald-600" />
                  </div>
                </div>
                <h3 className="text-base font-black text-slate-900 leading-tight">Tỷ lệ dữ liệu được kế thừa</h3>
                <p className="text-4xs text-slate-500 font-medium leading-relaxed">
                  Theo dõi nguyên tắc <b>&quot;chỉ cung cấp một lần&quot;</b>: tỷ lệ trường dữ liệu được kế thừa từ kỳ trước hoặc dữ liệu nền tảng, giúp giảm việc nhập lại.
                </p>
              </div>

              <div className="space-y-2 pt-2">
                <div className="flex justify-between items-baseline">
                  <span className="text-3xl font-black text-slate-900 tracking-tight">
                    {hasInheritedRate
                      ? `${Math.round(getPercent(data?.once_only_score))}%`
                      : "—"}
                  </span>
                  <span className="text-4xs text-slate-400 font-bold">
                    {hasInheritedRate
                      ? `Tối ưu hóa quy trình (${getNumerator(data?.once_only_score)}/${inheritedDenominator} chỉ số)`
                      : "Chưa có trường dữ liệu để tính"}
                  </span>
                </div>
                
                {/* Custom Progress bar */}
                <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden border border-slate-200/50">
                  <div 
                    className="bg-emerald-600 h-full rounded-full transition-all duration-700 ease-out"
                    style={{ width: `${getPercent(data?.once_only_score)}%` }}
                  />
                </div>
              </div>
            </div>

          </div>

          {/* Context Explanatory Footnote */}
          <div className="border border-slate-150 rounded-xl p-4 bg-slate-50/50 flex gap-3 text-4xs text-slate-500 font-medium leading-relaxed">
            <HelpCircle className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <span className="font-bold text-slate-700 block">Ý nghĩa thực tiễn chỉ số cải cách hành chính:</span>
              <p>
                <b>Tỷ lệ báo cáo điện tử:</b> Cho biết mức sử dụng biểu mẫu trực tuyến của các thôn trong kỳ đã chọn.
                <br />
                <b>Tỷ lệ dữ liệu được kế thừa:</b> Càng cao, cán bộ càng ít phải nhập lại những dữ liệu hệ thống đã có; đây là chỉ số hỗ trợ điều hành, không phải điểm xếp hạng cá nhân.
              </p>
            </div>
          </div>

          </div>
        ) : (
          <p className="text-xs text-slate-400 text-center">Không tìm thấy dữ liệu báo cáo nộp cho kỳ này.</p>
        )}
      </WorkSection>

    </div>
  );
}
