import { useEffect, useState, type ReactNode } from "react";
import { BookOpen, Database, Loader2, MapPin, Plus, RotateCw, Sparkles, Users } from "lucide-react";
import type { UserRole } from "../types";
import { apiJson } from "../lib/apiClient";
import { loadVillages } from "../lib/useVillages";
import { Button, EmptyState, ErrorState, PageHeader, SectionCard, StatusBadge } from "./ui";

type Props = { role: UserRole };
type Article = { id: string; title: string; summary?: string | null; category: string; audience: string; status: string; version: number };
type Champion = { id: string; user_id: string; skills?: string[]; support_schedule?: string | null; supported_groups?: string | null; is_active: boolean };
type SupportPoint = { id: string; name: string; address: string; opening_hours?: string | null; equipment?: string[]; champion_id?: string | null };
type Scenario = { id: string; name: string; description?: string | null; status: string };
type Officer = { id: string; name: string; role: string; is_active: boolean };
type Village = { id: string; name: string };
type EvacuationPoint = { id: string; village_id: string; name: string; latitude: number; longitude: number; capacity_households: number; contact_name: string; contact_phone: string; is_verified: boolean };

const CATEGORY_LABELS: Record<string, string> = {
  procedure: "Quy trình",
  guidance: "Hướng dẫn",
  lesson_learned: "Bài học kinh nghiệm",
  faq: "Hỏi đáp",
  policy: "Chính sách",
};

const roleLabel = (role: string) => ({ admin_xa: "Quản trị xã", to_cnscd: "Tổ CNSCĐ", can_bo_thon: "Cán bộ thôn", lanh_dao: "Lãnh đạo" }[role] || role);

export default function KnowledgeCenter({ role }: Props) {
  const admin = role === "admin_xa";
  const canViewEvacuation = admin || role === "lanh_dao";
  const [articles, setArticles] = useState<Article[]>([]);
  const [champions, setChampions] = useState<Champion[]>([]);
  const [points, setPoints] = useState<SupportPoint[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [villages, setVillages] = useState<Village[]>([]);
  const [evacuationPoints, setEvacuationPoints] = useState<EvacuationPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [articleTitle, setArticleTitle] = useState("");
  const [articleBody, setArticleBody] = useState("");
  const [championUserId, setChampionUserId] = useState("");
  const [championSkills, setChampionSkills] = useState("");
  const [championSchedule, setChampionSchedule] = useState("");
  const [championGroups, setChampionGroups] = useState("");
  const [pointName, setPointName] = useState("");
  const [pointAddress, setPointAddress] = useState("");
  const [pointHours, setPointHours] = useState("");
  const [pointEquipment, setPointEquipment] = useState("");
  const [pointChampionId, setPointChampionId] = useState("");
  const [scenarioName, setScenarioName] = useState("");
  const [runningScenario, setRunningScenario] = useState<string | null>(null);
  const [scenarioResult, setScenarioResult] = useState<Record<string, number> | null>(null);
  const [baselinePopulation, setBaselinePopulation] = useState("1000");
  const [baselineBudget, setBaselineBudget] = useState("100");
  const [baselineDemand, setBaselineDemand] = useState("100");
  const [populationChange, setPopulationChange] = useState("5");
  const [budgetChange, setBudgetChange] = useState("0");
  const [demandChange, setDemandChange] = useState("10");
  const [evacuationVillageId, setEvacuationVillageId] = useState("");
  const [evacuationName, setEvacuationName] = useState("");
  const [evacuationLatitude, setEvacuationLatitude] = useState("");
  const [evacuationLongitude, setEvacuationLongitude] = useState("");
  const [evacuationCapacity, setEvacuationCapacity] = useState("");
  const [evacuationContact, setEvacuationContact] = useState("Trực ban UBND xã");
  const [evacuationPhone, setEvacuationPhone] = useState("0000000000");

  const refresh = async () => {
    setLoading(true);
    setError(null);
    const requests: Promise<unknown>[] = [
      apiJson<Article[]>("/api/knowledge/articles"),
      apiJson<Champion[]>("/api/knowledge/champions"),
      apiJson<SupportPoint[]>("/api/knowledge/support-points"),
      apiJson<Scenario[]>("/api/knowledge/scenarios"),
    ];
    if (canViewEvacuation) requests.push(apiJson<Officer[]>("/auth/officers"), loadVillages(), apiJson<EvacuationPoint[]>("/api/pilots/evacuation-points/admin"));
    const results = await Promise.allSettled(requests);
    const assign = <T,>(index: number, setter: (value: T) => void) => {
      const result = results[index];
      if (result?.status === "fulfilled") setter(result.value as T);
    };
    assign<Article[]>(0, setArticles);
    assign<Champion[]>(1, setChampions);
    assign<SupportPoint[]>(2, setPoints);
    assign<Scenario[]>(3, setScenarios);
    if (canViewEvacuation) {
      assign<Officer[]>(4, setOfficers);
      const villageResult = results[5];
      if (villageResult?.status === "fulfilled") setVillages((villageResult.value as Village[]).map(({ id, name }) => ({ id, name })));
      assign<EvacuationPoint[]>(6, setEvacuationPoints);
    }
    if (results.slice(0, 4).every((result) => result.status === "rejected")) setError("Không tải được kho tri thức. Kiểm tra quyền truy cập hoặc kết nối rồi thử lại.");
    setLoading(false);
  };

  useEffect(() => { void refresh(); }, [canViewEvacuation]);

  const submit = async (action: () => Promise<unknown>, success: string) => {
    try {
      await action();
      setNotice(success);
      await refresh();
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Không thể cập nhật. Vui lòng thử lại.");
    }
  };

  const createArticle = () => submit(async () => {
    if (!articleTitle.trim() || !articleBody.trim()) throw new Error("Hãy nhập đủ tiêu đề và nội dung tài liệu.");
    await apiJson<Article>("/api/knowledge/articles", { method: "POST", body: JSON.stringify({ title: articleTitle.trim(), body: articleBody.trim(), category: "guidance", audience: "internal" }) });
    setArticleTitle(""); setArticleBody("");
  }, "Đã lưu bài viết ở trạng thái bản nháp. Admin phải duyệt trước khi chatbot nội bộ sử dụng.");

  const approveArticle = (id: string) => submit(() => apiJson<Article>(`/api/knowledge/articles/${id}/approve`, { method: "POST" }), "Đã duyệt tài liệu. Chatbot nội bộ chỉ dùng nội dung đã duyệt có nguồn và phiên bản.");

  const createChampion = () => submit(async () => {
    if (!championUserId) throw new Error("Hãy chọn cán bộ phụ trách.");
    await apiJson<Champion>("/api/knowledge/champions", { method: "POST", body: JSON.stringify({ user_id: championUserId, skills: splitValues(championSkills), support_schedule: championSchedule.trim() || null, supported_groups: championGroups.trim() || null }) });
    setChampionUserId(""); setChampionSkills(""); setChampionSchedule(""); setChampionGroups("");
  }, "Đã thêm Đại sứ số và ghi nhận người phụ trách.");

  const createPoint = () => submit(async () => {
    if (!pointName.trim() || !pointAddress.trim()) throw new Error("Hãy nhập tên và địa chỉ điểm hỗ trợ.");
    await apiJson<SupportPoint>("/api/knowledge/support-points", { method: "POST", body: JSON.stringify({ name: pointName.trim(), address: pointAddress.trim(), opening_hours: pointHours.trim() || null, equipment: splitValues(pointEquipment), champion_id: pointChampionId || null }) });
    setPointName(""); setPointAddress(""); setPointHours(""); setPointEquipment(""); setPointChampionId("");
  }, "Đã thêm điểm hỗ trợ cộng đồng.");

  const createScenario = () => submit(async () => {
    if (!scenarioName.trim()) throw new Error("Hãy nhập tên kịch bản.");
    await apiJson<Scenario>("/api/knowledge/scenarios", { method: "POST", body: JSON.stringify({ name: scenarioName.trim() }) });
    setScenarioName("");
  }, "Đã tạo kịch bản. Kết quả mô phỏng không ghi ngược vào dữ liệu báo cáo thật.");

  const runScenario = async (id: string) => {
    const values = [baselinePopulation, baselineBudget, baselineDemand, populationChange, budgetChange, demandChange].map(Number);
    if (values.some((item) => !Number.isFinite(item) || item < 0)) { setNotice("Giá trị mô phỏng phải là số không âm."); return; }
    setRunningScenario(id);
    try {
      const [population, budget, service_demand, population_change_pct, budget_change_pct, service_demand_change_pct] = values;
      const response = await apiJson<{ result?: { projection?: Record<string, number> } }>(`/api/knowledge/scenarios/${id}/run`, { method: "POST", body: JSON.stringify({ baseline: { population, budget, service_demand }, assumptions: { population_change_pct, budget_change_pct, service_demand_change_pct } }) });
      setScenarioResult(response.result?.projection || null);
      setNotice("Đã chạy mô phỏng xác định từ các giả định đã nhập. Đây không phải dự báo AI.");
    } catch (caught) { setNotice(caught instanceof Error ? caught.message : "Không thể chạy mô phỏng."); }
    finally { setRunningScenario(null); }
  };

  const createEvacuationPoint = () => submit(async () => {
    const latitude = Number(evacuationLatitude), longitude = Number(evacuationLongitude), capacity = Number(evacuationCapacity);
    if (!evacuationVillageId || !evacuationName.trim() || !Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isInteger(capacity) || capacity <= 0) throw new Error("Hãy nhập thôn, tên, tọa độ và sức chứa hợp lệ.");
    await apiJson<EvacuationPoint>("/api/pilots/evacuation-points", { method: "POST", body: JSON.stringify({ village_id: evacuationVillageId, name: evacuationName.trim(), latitude, longitude, capacity_households: capacity, contact_name: evacuationContact.trim() || "Trực ban UBND xã", contact_phone: evacuationPhone.trim() || "0000000000" }) });
    setEvacuationName(""); setEvacuationLatitude(""); setEvacuationLongitude(""); setEvacuationCapacity("");
  }, "Đã thêm điểm sơ tán ở trạng thái chờ xác minh. Chưa công khai cho người dân.");

  const toggleEvacuationPoint = (point: EvacuationPoint) => submit(() => apiJson<EvacuationPoint>(`/api/pilots/evacuation-points/${point.id}/verification`, { method: "PATCH", body: JSON.stringify({ is_verified: !point.is_verified }) }), point.is_verified ? "Đã ẩn điểm sơ tán khỏi cổng công khai." : "Đã xác minh và công bố điểm sơ tán.");

  if (loading) return <div role="status" className="flex min-h-64 items-center justify-center gap-2 text-sm text-slate-600"><Loader2 className="h-5 w-5 animate-spin text-emerald-800" />Đang tải kho tri thức…</div>;
  if (error) return <ErrorState description={error} onRetry={() => void refresh()} />;

  return <div className="knowledge-page space-y-5">
    <PageHeader eyebrow="NĂNG LỰC & TRI THỨC" title="Kho tri thức, hỗ trợ số & mô phỏng" description="Tài liệu đã duyệt, mạng lưới hỗ trợ số và các kịch bản tình huống. Mô phỏng không làm thay đổi số liệu báo cáo." actions={<Button variant="secondary" onClick={() => void refresh()}><RotateCw />Làm mới</Button>} />
    {notice && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-900">{notice}</div>}

    <SectionCard className="knowledge-section">
      <SectionTitle icon={<BookOpen />} title="Tài liệu nghiệp vụ" description="Chatbot nội bộ chỉ trả lời từ tài liệu đã duyệt, có nguồn và phiên bản." count={`${articles.length} tài liệu`} />
      <div className="mt-4 space-y-2">{articles.length ? articles.map((article) => <article key={article.id} className="rounded-xl border border-slate-200 bg-white p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold text-slate-900">{article.title}</h3><p className="mt-1 text-xs text-slate-500">{CATEGORY_LABELS[article.category] || article.category} · Phiên bản {article.version}</p></div><div className="flex items-center gap-2"><StatusBadge status={article.status} label={article.status === "approved" ? "Đã duyệt" : "Bản nháp"} />{admin && article.status !== "approved" && <Button onClick={() => void approveArticle(article.id)}>Duyệt</Button>}</div></div><p className="mt-2 text-sm text-slate-600">{article.summary || "Chưa có tóm tắt."}</p></article>) : <EmptyState title="Chưa có tài liệu" description="Admin có thể tạo bản nháp, rà soát nội dung rồi duyệt trước khi chatbot sử dụng." />}</div>
      {admin && <FormGrid className="mt-4"><Field label="Tiêu đề"><input value={articleTitle} onChange={(event) => setArticleTitle(event.target.value)} placeholder="Ví dụ: Quy trình tiếp nhận phản ánh" /></Field><Field label="Nội dung"><textarea value={articleBody} onChange={(event) => setArticleBody(event.target.value)} placeholder="Nội dung nghiệp vụ đã được kiểm duyệt nội bộ" /></Field><div><Button onClick={() => void createArticle()} disabled={!articleTitle.trim() || !articleBody.trim()}><Plus />Tạo bản nháp</Button></div></FormGrid>}
    </SectionCard>

    <div className="grid gap-5 lg:grid-cols-2">
      <SectionCard className="knowledge-section"><SectionTitle icon={<Users />} title="Đại sứ số" description="Cán bộ hỗ trợ người dân và nhóm yếu thế tiếp cận dịch vụ số." count={`${champions.length} người`} />
        {champions.length ? <ItemList>{champions.map((champion) => <li key={champion.id}><strong>{officers.find((officer) => officer.id === champion.user_id)?.name || "Cán bộ được phân công"}</strong><span>Kỹ năng: {champion.skills?.join(", ") || "Chưa cập nhật"}</span><span>Lịch hỗ trợ: {champion.support_schedule || "Chưa cập nhật"}</span><span>Nhóm hỗ trợ: {champion.supported_groups || "Chưa cập nhật"}</span></li>)}</ItemList> : <EmptyState title="Chưa có Đại sứ số" description="Admin chọn cán bộ trong danh sách để phân công hỗ trợ." />}
        {admin && <FormGrid className="mt-4"><Field label="Cán bộ phụ trách"><select value={championUserId} onChange={(event) => setChampionUserId(event.target.value)}><option value="">Chọn cán bộ phụ trách</option>{officers.filter((officer) => officer.is_active && !champions.some((item) => item.user_id === officer.id)).map((officer) => <option key={officer.id} value={officer.id}>{officer.name || officer.id} · {roleLabel(officer.role)}</option>)}</select></Field><Field label="Kỹ năng"><input value={championSkills} onChange={(event) => setChampionSkills(event.target.value)} placeholder="VD: DVC trực tuyến, hỗ trợ người cao tuổi" /></Field><Field label="Nhóm hỗ trợ"><input value={championGroups} onChange={(event) => setChampionGroups(event.target.value)} placeholder="VD: Người cao tuổi, hộ khó khăn" /></Field><Field label="Lịch hỗ trợ"><input value={championSchedule} onChange={(event) => setChampionSchedule(event.target.value)} placeholder="VD: Thứ 2–Thứ 6, 08:00–17:00" /></Field><div><Button onClick={() => void createChampion()} disabled={!championUserId}><Plus />Thêm Đại sứ số</Button></div></FormGrid>}
      </SectionCard>
      <SectionCard className="knowledge-section"><SectionTitle icon={<MapPin />} title="Điểm hỗ trợ cộng đồng" description="Địa điểm, lịch trực và thiết bị dùng chung phục vụ người dân." count={`${points.length} điểm`} />
        {points.length ? <ItemList>{points.map((point) => <li key={point.id}><strong>{point.name}</strong><span>{point.address}</span><span>Lịch trực: {point.opening_hours || "Chưa cập nhật"}</span><span>Thiết bị: {point.equipment?.join(", ") || "Chưa cập nhật"}</span></li>)}</ItemList> : <EmptyState title="Chưa có điểm hỗ trợ" description="Admin cấu hình địa điểm và thiết bị dùng chung trước khi công khai nội bộ." />}
        {admin && <FormGrid className="mt-4"><Field label="Tên điểm hỗ trợ"><input value={pointName} onChange={(event) => setPointName(event.target.value)} placeholder="Ví dụ: Nhà văn hóa thôn An Sơn" /></Field><Field label="Địa chỉ"><input value={pointAddress} onChange={(event) => setPointAddress(event.target.value)} placeholder="Thôn An Sơn, xã Bà Nà" /></Field><Field label="Lịch trực"><input value={pointHours} onChange={(event) => setPointHours(event.target.value)} placeholder="VD: Thứ 2–Thứ 6, 08:00–17:00" /></Field><Field label="Thiết bị"><input value={pointEquipment} onChange={(event) => setPointEquipment(event.target.value)} placeholder="VD: Máy tính, máy quét" /></Field><Field label="Đại sứ số phụ trách"><select value={pointChampionId} onChange={(event) => setPointChampionId(event.target.value)}><option value="">Chưa phân công</option>{champions.map((champion) => <option key={champion.id} value={champion.id}>{officers.find((officer) => officer.id === champion.user_id)?.name || champion.id}</option>)}</select></Field><div><Button onClick={() => void createPoint()} disabled={!pointName.trim() || !pointAddress.trim()}><Plus />Thêm điểm</Button></div></FormGrid>}
      </SectionCard>
    </div>

    {canViewEvacuation && <SectionCard className="knowledge-section"><SectionTitle icon={<MapPin />} title="Điểm sơ tán" description="Admin quản lý và xác minh; lãnh đạo xem. Chỉ điểm đã xác minh mới được công khai." count={`${evacuationPoints.length} điểm`} />
      {evacuationPoints.length ? <ItemList>{evacuationPoints.map((point) => <li key={point.id}><strong>{point.name}</strong><span>{villages.find((village) => village.id === point.village_id)?.name || "Chưa xác định thôn"} · Sức chứa {point.capacity_households.toLocaleString("vi-VN")} hộ</span><span>Tọa độ: {point.latitude}, {point.longitude}</span><div className="mt-2 flex flex-wrap items-center gap-2"><StatusBadge status={point.is_verified ? "approved" : "draft"} label={point.is_verified ? "Đã xác minh" : "Chờ xác minh"} />{admin && <Button variant="secondary" onClick={() => void toggleEvacuationPoint(point)}>{point.is_verified ? "Ẩn khỏi công khai" : "Xác minh & công khai"}</Button>}</div></li>)}</ItemList> : <EmptyState title="Chưa có điểm sơ tán" description="Admin thêm điểm sau khi có nguồn và đầu mối chính thức." />}
      {admin && <FormGrid className="mt-4"><Field label="Thôn"><select value={evacuationVillageId} onChange={(event) => setEvacuationVillageId(event.target.value)}><option value="">Chọn thôn</option>{villages.map((village) => <option key={village.id} value={village.id}>{village.name}</option>)}</select></Field><Field label="Tên điểm sơ tán"><input value={evacuationName} onChange={(event) => setEvacuationName(event.target.value)} placeholder="Ví dụ: Nhà văn hóa thôn" /></Field><Field label="Vĩ độ"><input type="number" min="-90" max="90" step="any" value={evacuationLatitude} onChange={(event) => setEvacuationLatitude(event.target.value)} placeholder="Ví dụ: 15.95" /></Field><Field label="Kinh độ"><input type="number" min="-180" max="180" step="any" value={evacuationLongitude} onChange={(event) => setEvacuationLongitude(event.target.value)} placeholder="Ví dụ: 108.12" /></Field><Field label="Sức chứa (hộ)"><input type="number" min="1" value={evacuationCapacity} onChange={(event) => setEvacuationCapacity(event.target.value)} /></Field><Field label="Đầu mối nội bộ"><input value={evacuationContact} onChange={(event) => setEvacuationContact(event.target.value)} /></Field><Field label="Số điện thoại nội bộ"><input value={evacuationPhone} onChange={(event) => setEvacuationPhone(event.target.value)} /></Field><div className="flex items-end"><Button onClick={() => void createEvacuationPoint()}><Plus />Tạo điểm chờ xác minh</Button></div></FormGrid>}
    </SectionCard>}

    <SectionCard className="knowledge-section"><SectionTitle icon={<Database />} title="Mô phỏng tình huống" description="Tính toán xác định từ dữ liệu nền và giả định; không phải dự báo AI, không sửa dữ liệu báo cáo thật." count={`${scenarios.length} kịch bản`} />
      <div className="mt-4 grid gap-3 md:grid-cols-3"><Field label="Dân số baseline"><input type="number" min="0" value={baselinePopulation} onChange={(event) => setBaselinePopulation(event.target.value)} /></Field><Field label="Ngân sách baseline"><input type="number" min="0" value={baselineBudget} onChange={(event) => setBaselineBudget(event.target.value)} /></Field><Field label="Nhu cầu dịch vụ baseline"><input type="number" min="0" value={baselineDemand} onChange={(event) => setBaselineDemand(event.target.value)} /></Field><Field label="Thay đổi dân số (%)"><input type="number" min="0" value={populationChange} onChange={(event) => setPopulationChange(event.target.value)} /></Field><Field label="Thay đổi ngân sách (%)"><input type="number" min="0" value={budgetChange} onChange={(event) => setBudgetChange(event.target.value)} /></Field><Field label="Thay đổi nhu cầu (%)"><input type="number" min="0" value={demandChange} onChange={(event) => setDemandChange(event.target.value)} /></Field></div>
      <div className="mt-4 space-y-2">{scenarios.length ? scenarios.map((scenario) => <article key={scenario.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-4"><div><h3 className="font-semibold">{scenario.name}</h3><p className="text-sm text-slate-600">{scenario.description || "Chưa có mô tả."}</p></div>{admin && <Button onClick={() => void runScenario(scenario.id)} disabled={runningScenario === scenario.id}>{runningScenario === scenario.id ? <Loader2 className="animate-spin" /> : <Sparkles />}Chạy mô phỏng</Button>}</article>) : <EmptyState title="Chưa có kịch bản" description="Admin tạo kịch bản để thử các giả định dân số, ngân sách hoặc nhu cầu dịch vụ." />}</div>
      {scenarioResult && <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950"><strong>Kết quả mô phỏng:</strong> {Object.entries(scenarioResult).map(([key, value]) => `${labelProjection(key)}: ${Number(value).toLocaleString("vi-VN")}`).join(" · ")}</div>}
      {admin && <div className="mt-4 flex flex-wrap gap-2"><input className="min-w-0 flex-1" value={scenarioName} onChange={(event) => setScenarioName(event.target.value)} placeholder="Tên kịch bản, ví dụ: Tăng nhu cầu dịch vụ 10%" /><Button onClick={() => void createScenario()} disabled={!scenarioName.trim()}><Plus />Tạo kịch bản</Button></div>}
    </SectionCard>
  </div>;
}

function SectionTitle({ icon, title, description, count }: { icon: ReactNode; title: string; description: string; count: string }) {
  return <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex gap-3"><span className="mt-0.5 text-emerald-800">{icon}</span><div><h2 className="text-lg font-bold text-slate-900">{title}</h2><p className="mt-1 text-sm text-slate-600">{description}</p></div></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{count}</span></div>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block text-sm font-semibold text-slate-700">{label}<div className="mt-1">{children}</div></label>;
}

function FormGrid({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`grid gap-3 md:grid-cols-2 ${className}`}>{children}</div>;
}

function ItemList({ children }: { children: ReactNode }) {
  return <ul className="mt-4 space-y-2">{children}</ul>;
}

function splitValues(value: string) { return value.split(",").map((item) => item.trim()).filter(Boolean); }
function labelProjection(key: string) { return ({ population: "Dân số", budget: "Ngân sách", service_demand: "Nhu cầu dịch vụ" }[key] || key); }
