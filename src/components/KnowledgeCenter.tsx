import { useEffect, useState } from "react";
import { BookOpen, Database, Loader2, MapPin, Plus, RotateCw, Sparkles, Users } from "lucide-react";
import type { UserRole } from "../types";
import { apiJson } from "../lib/apiClient";
import { Button, EmptyState, ErrorState, PageHeader, SectionCard, StatusBadge } from "./ui";

type Props = { role: UserRole };
type Article = { id: string; title: string; summary?: string | null; category: string; audience: string; status: string; version: number };
type Champion = { id: string; user_id: string; skills?: string[]; support_schedule?: string | null; supported_groups?: string | null; is_active: boolean };
type SupportPoint = { id: string; name: string; address: string; opening_hours?: string | null; equipment?: string[] };
type Scenario = { id: string; name: string; description?: string | null; status: string };
type Officer = { id: string; name: string; role: string; is_active: boolean };

const articleStatus: Record<string, string> = { draft: "Bản nháp", in_review: "Chờ duyệt", approved: "Đã duyệt", archived: "Lưu trữ" };
const categoryLabels: Record<string, string> = { procedure: "Quy trình", guidance: "Hướng dẫn", lesson_learned: "Bài học kinh nghiệm", faq: "Hỏi đáp", policy: "Chính sách" };

export default function KnowledgeCenter({ role }: Props) {
  const admin = role === "admin_xa";
  const [articles, setArticles] = useState<Article[]>([]);
  const [champions, setChampions] = useState<Champion[]>([]);
  const [points, setPoints] = useState<SupportPoint[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [articleTitle, setArticleTitle] = useState("");
  const [articleBody, setArticleBody] = useState("");
  const [pointName, setPointName] = useState("");
  const [pointAddress, setPointAddress] = useState("");
  const [pointHours, setPointHours] = useState("");
  const [scenarioName, setScenarioName] = useState("");
  const [runningScenario, setRunningScenario] = useState<string | null>(null);
  const [scenarioResult, setScenarioResult] = useState<Record<string, number> | null>(null);
  const [championUserId, setChampionUserId] = useState("");
  const [championSkills, setChampionSkills] = useState("");
  const [championSchedule, setChampionSchedule] = useState("");

  const refresh = async () => {
    setLoading(true); setError(null);
    const results = await Promise.allSettled([
      apiJson<Article[]>("/api/knowledge/articles"),
      apiJson<Champion[]>("/api/knowledge/champions"),
      apiJson<SupportPoint[]>("/api/knowledge/support-points"),
      apiJson<Scenario[]>("/api/knowledge/scenarios"),
      ...(admin ? [apiJson<Officer[]>("/auth/officers")] : []),
    ]);
    const [articlesResult, championsResult, pointsResult, scenariosResult, officersResult] = results;
    if (articlesResult.status === "fulfilled") setArticles(articlesResult.value);
    if (championsResult.status === "fulfilled") setChampions(championsResult.value);
    if (pointsResult.status === "fulfilled") setPoints(pointsResult.value);
    if (scenariosResult.status === "fulfilled") setScenarios(scenariosResult.value);
    if (officersResult?.status === "fulfilled") setOfficers(officersResult.value as Officer[]);
    if (results.every((result) => result.status === "rejected")) setError("Không tải được kho tri thức. Kiểm tra quyền truy cập hoặc kết nối rồi thử lại.");
    setLoading(false);
  };
  useEffect(() => { void refresh(); }, []);

  const createArticle = async () => {
    if (!articleTitle.trim() || !articleBody.trim()) return;
    await apiJson<Article>("/api/knowledge/articles", { method: "POST", body: JSON.stringify({ title: articleTitle.trim(), body: articleBody.trim(), category: "guidance", audience: "internal" }) });
    setArticleTitle(""); setArticleBody(""); setNotice("Đã lưu bài viết ở trạng thái bản nháp; cần admin duyệt trước khi dùng cho chatbot."); await refresh();
  };
  const approveArticle = async (id: string) => { await apiJson<Article>(`/api/knowledge/articles/${id}/approve`, { method: "POST" }); setNotice("Đã duyệt tài liệu và ghi nhận người duyệt."); await refresh(); };
  const createPoint = async () => {
    if (!pointName.trim() || !pointAddress.trim()) return;
    await apiJson<SupportPoint>("/api/knowledge/support-points", { method: "POST", body: JSON.stringify({ name: pointName.trim(), address: pointAddress.trim(), opening_hours: pointHours.trim() || null }) });
    setPointName(""); setPointAddress(""); setPointHours(""); setNotice("Đã thêm điểm hỗ trợ cộng đồng."); await refresh();
  };
  const createChampion = async () => {
    if (!championUserId) return;
    await apiJson<Champion>("/api/knowledge/champions", { method: "POST", body: JSON.stringify({ user_id: championUserId, skills: championSkills.split(",").map((item) => item.trim()).filter(Boolean), support_schedule: championSchedule.trim() || null }) });
    setChampionUserId(""); setChampionSkills(""); setChampionSchedule(""); setNotice("Đã thêm Digital Champion và ghi nhận người phụ trách."); await refresh();
  };
  const createScenario = async () => {
    if (!scenarioName.trim()) return;
    await apiJson<Scenario>("/api/knowledge/scenarios", { method: "POST", body: JSON.stringify({ name: scenarioName.trim() }) });
    setScenarioName(""); setNotice("Đã tạo kịch bản. Kết quả mô phỏng không ghi ngược vào dữ liệu thật."); await refresh();
  };
  const runScenario = async (id: string) => {
    setRunningScenario(id); setScenarioResult(null);
    try {
      const result = await apiJson<{ result?: { projection?: Record<string, number> } }>(`/api/knowledge/scenarios/${id}/run`, { method: "POST", body: JSON.stringify({ baseline: { population: 1000, budget: 100, service_demand: 100 }, assumptions: { population_change_pct: 5, budget_change_pct: 0, service_demand_change_pct: 10 } }) });
      setScenarioResult(result.result?.projection || null); setNotice("Đã chạy mô phỏng xác định. Đây là kết quả tham khảo, không phải dự báo AI.");
    } finally { setRunningScenario(null); }
  };

  if (loading) return <div role="status" className="flex min-h-64 items-center justify-center gap-2 text-sm text-slate-600"><Loader2 className="h-5 w-5 animate-spin text-emerald-800" />Đang tải kho tri thức…</div>;
  if (error) return <ErrorState description={error} onRetry={() => void refresh()} />;
  return <div className="knowledge-page space-y-5">
    <PageHeader eyebrow="NĂNG LỰC & TRI THỨC" title="Kho tri thức và mô phỏng" description="Tài liệu đã duyệt, mạng lưới hỗ trợ số và kịch bản what-if cho xã Bà Nà." actions={<Button variant="secondary" onClick={() => void refresh()}><RotateCw />Làm mới</Button>} />
    {notice && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-900">{notice}</div>}
    <SectionCard className="knowledge-section knowledge-section--articles"><div className="knowledge-section__header"><span className="knowledge-section__icon knowledge-section__icon--book"><BookOpen /></span><div><div className="knowledge-section__eyebrow">Nội dung chuẩn</div><h2>Tài liệu nghiệp vụ</h2><p>Chatbot nội bộ chỉ dùng nội dung có nguồn và phiên bản.</p></div><span className="knowledge-section__count">{articles.length} tài liệu</span></div>
      <div className="mt-4 space-y-2">{articles.length ? articles.map((article) => <article key={article.id} className="rounded-lg border border-slate-200 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-semibold">{article.title}</h3><p className="text-xs text-slate-500">{categoryLabels[article.category] || article.category} · phiên bản {article.version}</p></div><div className="flex items-center gap-2"><StatusBadge status={article.status} />{admin && article.status !== "approved" && <Button size="sm" onClick={() => void approveArticle(article.id)}>Duyệt</Button>}</div></div><p className="mt-1 text-sm text-slate-600">{article.summary || "Chưa có tóm tắt"}</p></article>) : <EmptyState title="Chưa có bài viết" description="Admin có thể tạo bản nháp rồi duyệt sau khi rà soát nội dung." />}</div>
      {admin && <div className="mt-4 grid gap-3 md:grid-cols-2"><label className="text-sm font-semibold">Tiêu đề<input className="mt-1 w-full" value={articleTitle} onChange={(event) => setArticleTitle(event.target.value)} placeholder="Ví dụ: Quy trình tiếp nhận phản ánh" /></label><label className="text-sm font-semibold md:row-span-2">Nội dung<textarea className="mt-1 min-h-24 w-full" value={articleBody} onChange={(event) => setArticleBody(event.target.value)} placeholder="Nội dung đã được kiểm duyệt nội bộ" /></label><div className="flex items-end"><Button onClick={() => void createArticle()} disabled={!articleTitle.trim() || !articleBody.trim()}><Plus />Tạo bản nháp</Button></div></div>}
    </SectionCard>
    <div className="grid gap-5 lg:grid-cols-2"><SectionCard className="knowledge-section knowledge-section--champions"><div className="knowledge-section__header"><span className="knowledge-section__icon knowledge-section__icon--people"><Users /></span><div><div className="knowledge-section__eyebrow">Mạng lưới hỗ trợ</div><h2>Digital Champions</h2><p>Cán bộ hỗ trợ người dân và nhóm yếu thế.</p></div><span className="knowledge-section__count">{champions.length} người</span></div>{champions.length ? <ul className="knowledge-list mt-4">{champions.map((champion) => <li key={champion.id} className="knowledge-item"><strong>{officers.find((officer) => officer.id === champion.user_id)?.name || champion.user_id}</strong><span>Kỹ năng: {champion.skills?.join(", ") || "Chưa cập nhật"}</span><span>Lịch hỗ trợ: {champion.support_schedule || "Chưa cập nhật"}</span></li>)}</ul> : <EmptyState title="Chưa có đại sứ số" description="Admin chọn cán bộ trong danh sách để phân công hỗ trợ." />}{admin && <div className="knowledge-form mt-4"><p className="knowledge-form__title">Thêm người phụ trách</p><select value={championUserId} onChange={(event) => setChampionUserId(event.target.value)}><option value="">Chọn cán bộ phụ trách</option>{officers.filter((officer) => officer.is_active && !champions.some((champion) => champion.user_id === officer.id)).map((officer) => <option key={officer.id} value={officer.id}>{officer.name || officer.id} · {officer.role === "to_cnscd" ? "Tổ CNSCĐ" : "Cán bộ thôn"}</option>)}</select><input value={championSkills} onChange={(event) => setChampionSkills(event.target.value)} placeholder="Kỹ năng, phân cách bằng dấu phẩy" /><div className="flex gap-2"><input className="min-w-0 flex-1" value={championSchedule} onChange={(event) => setChampionSchedule(event.target.value)} placeholder="Lịch hỗ trợ" /><Button onClick={() => void createChampion()} disabled={!championUserId}><Plus />Thêm Champion</Button></div></div>}</SectionCard>
      <SectionCard className="knowledge-section knowledge-section--points"><div className="knowledge-section__header"><span className="knowledge-section__icon knowledge-section__icon--location"><MapPin /></span><div><div className="knowledge-section__eyebrow">Hỗ trợ tại chỗ</div><h2>Điểm hỗ trợ cộng đồng</h2><p>Địa điểm, lịch trực và thiết bị dùng chung.</p></div><span className="knowledge-section__count">{points.length} điểm</span></div>{points.length ? <ul className="knowledge-list mt-4">{points.map((point) => <li key={point.id} className="knowledge-item"><strong>{point.name}</strong><span>{point.address}</span><span>{point.opening_hours || "Chưa cập nhật lịch"}</span></li>)}</ul> : <EmptyState title="Chưa có điểm hỗ trợ" description="Admin cấu hình địa điểm và người phụ trách để công khai trong nội bộ." />}{admin && <div className="knowledge-form mt-4"><p className="knowledge-form__title">Thêm điểm hỗ trợ</p><input value={pointName} onChange={(event) => setPointName(event.target.value)} placeholder="Tên điểm hỗ trợ" /><input value={pointAddress} onChange={(event) => setPointAddress(event.target.value)} placeholder="Địa chỉ" /><div className="flex gap-2"><input className="min-w-0 flex-1" value={pointHours} onChange={(event) => setPointHours(event.target.value)} placeholder="Lịch trực (ví dụ: T2–T6, 8:00–17:00)" /><Button onClick={() => void createPoint()} disabled={!pointName.trim() || !pointAddress.trim()}><Plus />Thêm điểm</Button></div></div>}</SectionCard></div>
    <SectionCard className="knowledge-section knowledge-section--scenarios"><div className="knowledge-section__header"><span className="knowledge-section__icon knowledge-section__icon--scenario"><Database /></span><div><div className="knowledge-section__eyebrow">Phân tích quyết định</div><h2>Mô phỏng what-if</h2><p>Tính toán xác định từ baseline; không phải dự báo AI và không sửa dữ liệu thật.</p></div><span className="knowledge-section__count">{scenarios.length} kịch bản</span></div>{scenarios.length ? <div className="knowledge-list mt-4">{scenarios.map((scenario) => <div key={scenario.id} className="knowledge-item knowledge-item--row"><div><strong>{scenario.name}</strong><span>{scenario.description || "Chưa có mô tả"}</span></div>{admin && <Button onClick={() => void runScenario(scenario.id)} disabled={runningScenario === scenario.id}>{runningScenario === scenario.id ? <Loader2 className="animate-spin" /> : <Sparkles />}Chạy mô phỏng</Button>}</div>)}</div> : <EmptyState title="Chưa có kịch bản" description="Tạo kịch bản để thử các giả định dân số, ngân sách và nhu cầu dịch vụ." />}{scenarioResult && <div role="status" className="knowledge-result mt-3"><strong>Kết quả mô phỏng:</strong> {Object.entries(scenarioResult).map(([key, value]) => `${key}: ${value}`).join(" · ")}</div>}{admin && <div className="knowledge-form mt-4"><p className="knowledge-form__title">Tạo kịch bản mới</p><div className="flex gap-3"><input className="min-w-0 flex-1" value={scenarioName} onChange={(event) => setScenarioName(event.target.value)} placeholder="Tên kịch bản, ví dụ: Tăng nhu cầu dịch vụ 10%" /><Button onClick={() => void createScenario()} disabled={!scenarioName.trim()}><Plus />Tạo kịch bản</Button></div></div>}</SectionCard>
  </div>;
}
