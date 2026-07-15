import { useState, useEffect } from "react";
import { Users, Info, AlertTriangle, CheckCircle, HelpCircle, UserCheck } from "lucide-react";
import { apiFetch } from "../lib/apiClient";

interface CnscdImpactProps {
  selectedPeriod: string;
}

interface AssistedReportDetail {
  report_id: string;
  village_id: string;
  village_name: string;
  assisted_member_name: string;
  reporter_name: string;
  ct13_value: number;
}

interface CnscdImpactData {
  period_id: string;
  assisted_reports_count: number;
  total_reported_ct13: number;
  deviation: number;
  status: string;
  warning_message: string | null;
  details: AssistedReportDetail[];
}

export default function CnscdImpact({ selectedPeriod }: CnscdImpactProps) {
  const [data, setData] = useState<CnscdImpactData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchImpact() {
      setLoading(true);
      setError(null);
      try {
        const response = await apiFetch(`/api/cnscd-impact?period_id=${encodeURIComponent(selectedPeriod)}`, {
          headers: {
            "Accept": "application/json"
          }
        });
        if (!response.ok) {
          throw new Error("Không thể tải dữ liệu hiệu quả hỗ trợ CNSCĐ");
        }
        const result = await response.json();
        setData(result);
      } catch (err: any) {
        setError(err.message || "Đã xảy ra lỗi không xác định");
      } finally {
        setLoading(false);
      }
    }

    if (selectedPeriod) {
      fetchImpact();
    }
  }, [selectedPeriod]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-3">
        <div className="w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin"></div>
        <p className="text-xs text-slate-500 font-medium">Đang tính toán mức độ ảnh hưởng của Tổ CNSCĐ...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="border border-red-200 bg-red-50/50 rounded-2xl p-6 text-center space-y-2">
        <AlertTriangle className="w-8 h-8 text-red-500 mx-auto" />
        <h3 className="text-sm font-bold text-red-950">Lỗi tải dữ liệu</h3>
        <p className="text-xs text-red-700">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <p className="text-xs text-slate-400 text-center py-12">Không tìm thấy dữ liệu đối chiếu hiệu quả.</p>
    );
  }

  // Determine status color & label
  const getStatusConfig = (status: string) => {
    switch (status) {
      case "normal":
        return {
          bg: "bg-emerald-50 border-emerald-200 text-emerald-800",
          icon: <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0" />,
          label: "Khớp hợp lệ / Chênh lệch nhỏ",
          indicatorColor: "bg-emerald-500"
        };
      case "discrepancy":
        return {
          bg: "bg-rose-50 border-rose-200 text-rose-800",
          icon: <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />,
          label: "Lệch nghiêm trọng (Khai thiếu)",
          indicatorColor: "bg-rose-500"
        };
      case "unverified":
        return {
          bg: "bg-amber-50 border-amber-200 text-amber-800",
          icon: <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />,
          label: "Chưa ghi nhận hỗ trợ trực tiếp",
          indicatorColor: "bg-amber-500"
        };
      case "low_recorded_assistance":
        return {
          bg: "bg-amber-50 border-amber-200 text-amber-800",
          icon: <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />,
          label: "Hỗ trợ ghi nhận thấp hơn tự khai",
          indicatorColor: "bg-amber-500"
        };
      case "excessive_assistance":
        return {
          bg: "bg-emerald-50 border-emerald-200 text-emerald-800",
          icon: <Info className="w-5 h-5 text-emerald-600 shrink-0" />,
          label: "Hỗ trợ thực tế cao hơn tự khai",
          indicatorColor: "bg-emerald-600"
        };
      default:
        return {
          bg: "bg-slate-50 border-slate-200 text-slate-800",
          icon: <HelpCircle className="w-5 h-5 text-slate-600 shrink-0" />,
          label: "Chưa phân tích",
          indicatorColor: "bg-slate-500"
        };
    }
  };

  const statusConfig = getStatusConfig(data.status);

  return (
    <div className="space-y-6">
      {/* Overview Title and description */}
      <div className="space-y-1">
        <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
          <Users className="w-5 h-5 text-emerald-600" />
          <span>Đo lường Hiệu quả & Xác thực Chỉ tiêu CT13 (Tổ CNSCĐ)</span>
        </h2>
        <p className="text-4xs text-slate-500 max-w-3xl leading-normal">
          Thống kê đối chiếu giữa <b>số lượt Tổ Công nghệ số cộng đồng (CNSCĐ) hỗ trợ nộp trực tiếp</b> (số liệu thực tế có ghi nhận định danh người nộp) với <b>chỉ tiêu CT13</b> (&quot;số người được hướng dẫn dịch vụ công trực tuyến&quot;) do các thôn tự khai báo.
        </p>
      </div>

      {/* Main Stats Bento-Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        
        {/* Card 1: Hỗ trợ thực tế */}
        <div className="border border-slate-150 rounded-2xl p-5 hover:shadow-xs transition-all flex flex-col justify-between">
          <div className="space-y-1">
            <span className="text-4xs text-emerald-600 font-bold uppercase tracking-wider">Thực tế hỗ trợ</span>
            <h3 className="text-2xl font-black text-slate-900">{data.assisted_reports_count} lượt</h3>
            <p className="text-4xs text-slate-500 leading-tight">
              Số báo cáo nộp có tích chọn &quot;Tôi đang hỗ trợ nhập hộ&quot; bởi cán bộ Tổ CNSCĐ trong kỳ.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center gap-1.5 text-4xs text-slate-400 font-semibold">
            <UserCheck className="w-3.5 h-3.5 text-emerald-600" />
            <span>Xác thực định danh</span>
          </div>
        </div>

        {/* Card 2: Thôn tự khai CT13 */}
        <div className="border border-slate-150 rounded-2xl p-5 hover:shadow-xs transition-all flex flex-col justify-between">
          <div className="space-y-1">
            <span className="text-4xs text-amber-600 font-bold uppercase tracking-wider">Thôn tự khai (CT13)</span>
            <h3 className="text-2xl font-black text-slate-900">{data.total_reported_ct13} người</h3>
            <p className="text-4xs text-slate-500 leading-tight">
              Tổng số người được hướng dẫn dùng DVC trực tuyến do 10 thôn tự khai báo trong biểu mẫu.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center gap-1.5 text-4xs text-slate-400 font-semibold">
            <Info className="w-3.5 h-3.5 text-amber-500" />
            <span>Số liệu tự báo cáo</span>
          </div>
        </div>

        {/* Card 3: Chênh lệch */}
        <div className="border border-slate-150 rounded-2xl p-5 hover:shadow-xs transition-all flex flex-col justify-between">
          <div className="space-y-1">
            <span className="text-4xs text-rose-600 font-bold uppercase tracking-wider">Độ lệch thẩm định</span>
            <h3 className={`text-2xl font-black ${data.deviation > 0 ? "text-rose-600" : data.deviation < 0 ? "text-emerald-600" : "text-emerald-600"}`}>
              {data.deviation > 0 ? `+${data.deviation}` : data.deviation}
            </h3>
            <p className="text-4xs text-slate-500 leading-tight">
              Chênh lệch giữa số tự khai báo và lượt ghi nhận thực tế từ Tổ CNSCĐ.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${statusConfig.indicatorColor}`} />
            <span className="text-4xs text-slate-600 font-bold">{statusConfig.label}</span>
          </div>
        </div>

      </div>

      {/* Warning/Status Callout Message */}
      {data.warning_message && (
        <div className={`border rounded-xl p-4 flex gap-3 text-xs leading-relaxed ${statusConfig.bg}`}>
          {statusConfig.icon}
          <div>
            <span className="font-bold block mb-0.5">Cảnh báo giám sát số liệu:</span>
            <p className="text-4xs font-medium">{data.warning_message}</p>
          </div>
        </div>
      )}

      {/* Detailed comparison list */}
      <div className="border border-slate-150 rounded-2xl overflow-hidden bg-white">
        <div className="border-b border-slate-150 bg-slate-50 px-4 py-3">
          <h3 className="text-xs font-bold text-slate-700">Chi tiết nhật ký Tổ CNSCĐ hỗ trợ trực tiếp trong {selectedPeriod}</h3>
        </div>

        {data.details.length > 0 ? (
          <div className="divide-y divide-slate-100 overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50 text-4xs font-extrabold uppercase tracking-wider text-slate-500 border-b border-slate-100">
                  <th className="px-4 py-2.5">Thôn</th>
                  <th className="px-4 py-2.5">Thành viên hỗ trợ</th>
                  <th className="px-4 py-2.5">Cán bộ thôn được giúp</th>
                  <th className="px-4 py-2.5" align="right">Chỉ số CT13 tự khai</th>
                  <th className="px-4 py-2.5 text-center">Trạng thái xác thực</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs text-slate-600 font-medium">
                {data.details.map((item, idx) => (
                  <tr key={item.report_id || idx} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-4 py-3 font-bold text-slate-900">{item.village_name}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-md text-3xs font-extrabold border border-emerald-100">
                        <UserCheck className="w-3 h-3" />
                        {item.assisted_member_name}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{item.reporter_name}</td>
                    <td className="px-4 py-3 font-mono font-bold text-slate-900" align="right">{item.ct13_value} người</td>
                    <td className="px-4 py-3 text-center">
                      {item.ct13_value > 1 ? (
                        <span className="inline-flex items-center gap-1 text-4xs font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-100">
                          Thẩm định lệch {item.ct13_value - 1}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-4xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
                          Khớp hợp lệ (1-1)
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center text-xs text-slate-400 font-medium space-y-1">
            <p>Chưa ghi nhận hoạt động nộp hộ trực tiếp nào từ Tổ CNSCĐ trong kỳ này.</p>
            <p className="text-4xs text-slate-400 italic">Mọi báo cáo đều được các thôn tự nộp trực tuyến mà không cần qua Tổ CNSCĐ hỗ trợ nhập hộ.</p>
          </div>
        )}
      </div>

    </div>
  );
}
