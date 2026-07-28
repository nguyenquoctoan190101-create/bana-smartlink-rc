import { useState } from "react";
import type { FormEvent } from "react";
import { FileSearch, Search } from "lucide-react";
import { apiJson, toUserFacingError } from "../lib/apiClient";
import {
  formatPublicLookupMessage,
  getPublicLookupEndpoint,
  isExampleLookupCode,
  type PublicLookupResult,
} from "../lib/publicLookup";
import { Button, PageHeader, SectionCard } from "./ui";

export default function RecordLookup() {
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleLookup = async (event: FormEvent) => {
    event.preventDefault();
    const normalizedCode = code.trim().toUpperCase();
    if (isExampleLookupCode(normalizedCode)) {
      setMessage(null);
      setError(
        "Đây là mã ví dụ để minh họa định dạng, không phải mã hồ sơ thật. Vui lòng nhập mã đã được cấp khi gửi hồ sơ.",
      );
      return;
    }
    const endpoint = getPublicLookupEndpoint(code);
    if (!endpoint) {
      setMessage(null);
      setError("Mã hồ sơ phải gồm 16 ký tự (kiến nghị số liệu) hoặc 32 ký tự (phản ánh hiện trường).");
      return;
    }

    setIsLoading(true);
    setError(null);
    setMessage(null);
    try {
      const result = await apiJson<PublicLookupResult>(endpoint, {
        auth: "none",
        cache: "no-store",
      });
      setMessage(formatPublicLookupMessage(result));
    } catch (lookupError) {
      setError(toUserFacingError(
        lookupError,
        "Không tra cứu được hồ sơ. Vui lòng kiểm tra mã và thử lại.",
        {
          notFound:
            "Không tìm thấy hồ sơ tương ứng. Vui lòng kiểm tra lại mã đã được cấp.",
        },
      ));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Tra cứu trực tuyến"
        title="Tra cứu hồ sơ"
        description="Dùng chung một mã tra cứu cho kiến nghị số liệu và phản ánh hiện trường. Kết quả không hiển thị thông tin cá nhân của người gửi."
      />
      <SectionCard className="mx-auto max-w-3xl p-5 sm:p-6 md:p-8">
        <div className="mb-5 flex items-start gap-3">
          <span className="shrink-0 rounded-xl bg-emerald-50 p-3 text-emerald-800"><FileSearch aria-hidden="true" className="h-6 w-6" /></span>
          <div>
            <h2 className="text-lg font-bold text-slate-950">Nhập mã đã được cấp</h2>
            <p id="record-lookup-help" className="mt-1 text-sm text-slate-600">Mã kiến nghị có 16 ký tự; mã phản ánh hiện trường có 32 ký tự.</p>
          </div>
        </div>
        <div
          className="grid gap-3 sm:grid-cols-2"
          aria-label="Ví dụ định dạng mã tra cứu"
        >
          <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <span className="mb-2 inline-flex rounded-full border border-amber-300 bg-amber-100 px-2 py-1 text-[0.65rem] font-black uppercase tracking-wide text-amber-950">
              Mã ví dụ — không dùng để tra cứu
            </span>
            <p className="text-xs font-semibold text-slate-600">
              Đề nghị đối chiếu · 16 ký tự
            </p>
            <code className="mt-1 block break-all text-xs font-bold tracking-wide text-emerald-800">
              A1B2C3D4E5F6G7H8
            </code>
          </div>
          <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <span className="mb-2 inline-flex rounded-full border border-amber-300 bg-amber-100 px-2 py-1 text-[0.65rem] font-black uppercase tracking-wide text-amber-950">
              Mã ví dụ — không dùng để tra cứu
            </span>
            <p className="text-xs font-semibold text-slate-600">
              Phản ánh hiện trường · 32 ký tự
            </p>
            <code className="mt-1 block break-all text-xs font-bold tracking-wide text-emerald-800">
              A1B2C3D4E5F6G7H8J9K0L1M2N3P4Q5R6
            </code>
          </div>
        </div>
        <p className="mt-3 rounded-lg border-l-4 border-amber-400 bg-amber-50 px-3 py-2 text-xs font-semibold leading-relaxed text-amber-950">
          Hai mã phía trên chỉ minh họa hình thức và không có hồ sơ tương ứng.
          Hãy nhập liền các ký tự của mã thật đã được cấp cho bạn.
        </p>
        <form onSubmit={handleLookup} className="space-y-3">
          <label htmlFor="internal-record-code" className="mt-5 block text-sm font-semibold text-slate-800">Mã tra cứu thật đã được cấp</label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              id="internal-record-code"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              autoComplete="off"
              spellCheck={false}
              maxLength={32}
              aria-describedby="record-lookup-help record-lookup-state-help"
              placeholder="Nhập mã thật đã được cấp (16 hoặc 32 ký tự)"
              className="min-h-11 flex-1 rounded-xl border border-slate-300 bg-white px-4 font-mono text-sm uppercase outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100"
            />
            <Button type="submit" disabled={isLoading} className="w-full justify-center sm:min-w-32 sm:w-auto">
              <Search aria-hidden="true" className="h-4 w-4" />
              {isLoading ? "Đang tra cứu…" : "Tra cứu"}
            </Button>
          </div>
        </form>
        {error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800" role="alert">{error}</div>}
        {message && <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900" role="status">{message}</div>}
        <div
          id="record-lookup-state-help"
          className="mt-5 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600"
        >
          <h3 className="font-bold text-slate-900">Cách hiểu kết quả</h3>
          <ul className="mt-2 space-y-1.5 pl-5">
            <li className="list-disc">
              <strong>Đã tiếp nhận, đang xác minh hoặc đang xử lý:</strong> hồ
              sơ vẫn đang được đơn vị phụ trách xử lý.
            </li>
            <li className="list-disc">
              <strong>Hoàn thành, đã chấp nhận hoặc đã từ chối:</strong> đây là
              trạng thái hiện tại của hồ sơ.
            </li>
            <li className="list-disc">
              <strong>Không tìm thấy:</strong> kiểm tra lại số ký tự và mã đã
              được cấp.
            </li>
          </ul>
          <p className="mt-3 text-xs leading-relaxed text-slate-500">
            Trang chỉ hiển thị kết quả của mã đang nhập và không tạo danh sách
            lịch sử tra cứu.
          </p>
        </div>
      </SectionCard>
    </div>
  );
}
