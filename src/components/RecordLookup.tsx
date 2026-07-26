import { useState } from "react";
import type { FormEvent } from "react";
import { FileSearch, Search } from "lucide-react";
import { apiJson, toUserFacingError } from "../lib/apiClient";
import {
  formatPublicLookupMessage,
  getPublicLookupEndpoint,
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
      const result = await apiJson<PublicLookupResult>(endpoint, { cache: "no-store" });
      setMessage(formatPublicLookupMessage(result));
    } catch (lookupError) {
      setError(toUserFacingError(lookupError, "Không tra cứu được hồ sơ. Vui lòng kiểm tra mã và thử lại."));
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
      <SectionCard className="mx-auto max-w-2xl p-6 md:p-8">
        <div className="mb-5 flex items-start gap-3">
          <span className="rounded-xl bg-emerald-50 p-3 text-emerald-800"><FileSearch aria-hidden="true" className="h-6 w-6" /></span>
          <div>
            <h2 className="text-lg font-bold text-slate-950">Nhập mã đã được cấp</h2>
            <p className="mt-1 text-sm text-slate-600">Mã kiến nghị có 16 ký tự; mã phản ánh hiện trường có 32 ký tự.</p>
          </div>
        </div>
        <form onSubmit={handleLookup} className="space-y-3">
          <label htmlFor="internal-record-code" className="block text-sm font-semibold text-slate-800">Mã tra cứu</label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              id="internal-record-code"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              autoComplete="off"
              spellCheck={false}
              maxLength={32}
              placeholder="Nhập mã 16 hoặc 32 ký tự"
              className="min-h-11 flex-1 rounded-xl border border-slate-300 bg-white px-4 font-mono text-sm uppercase outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100"
            />
            <Button type="submit" disabled={isLoading} className="min-w-32 justify-center">
              <Search aria-hidden="true" className="h-4 w-4" />
              {isLoading ? "Đang tra cứu…" : "Tra cứu"}
            </Button>
          </div>
        </form>
        {error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800" role="alert">{error}</div>}
        {message && <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900" role="status">{message}</div>}
      </SectionCard>
    </div>
  );
}
