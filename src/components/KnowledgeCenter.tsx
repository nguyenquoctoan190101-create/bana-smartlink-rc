import { useEffect, useState, type ReactNode } from "react";
import { BookOpen, Database, Loader2, MapPin, Plus, RotateCw, Sparkles, Users } from "lucide-react";
import type { UserRole } from "../types";
import { apiJson, toUserFacingError } from "../lib/apiClient";
import { loadVillages } from "../lib/useVillages";
import { Button, EmptyState, ErrorState, PageHeader, SectionCard, StatusBadge } from "./ui";

type Props = { role: UserRole; scenarioEnabled?: boolean };
type Article = {
  id: string;
  title: string;
  summary?: string | null;
  category: string;
  audience: string;
  status: string;
  version: number;
};
type Champion = {
  id: string;
  user_id: string;
  skills?: string[];
  support_schedule?: string | null;
  supported_groups?: string | null;
  is_active: boolean;
};
type SupportPoint = {
  id: string;
  name: string;
  address: string;
  opening_hours?: string | null;
  equipment?: string[];
  champion_id?: string | null;
};
type Scenario = {
  id: string;
  name: string;
  description?: string | null;
  status: string;
};
type Officer = { id: string; name: string; role: string; is_active: boolean };
type Village = { id: string; name: string };
type EvacuationPoint = {
  id: string;
  village_id: string;
  name: string;
  latitude: number;
  longitude: number;
  capacity_households: number;
  contact_name: string;
  contact_phone: string | null;
  is_verified: boolean;
};

const CATEGORY_LABELS: Record<string, string> = {
  procedure: "Quy trình",
  guidance: "Hướng dẫn",
  lesson_learned: "Bài học kinh nghiệm",
  faq: "Hỏi đáp",
  policy: "Chính sách",
};

const roleLabel = (role: string) =>
  ({
    admin_xa: "Cán bộ xã",
    to_cnscd: "Tổ công nghệ số cộng đồng",
    can_bo_thon: "Cán bộ thôn",
    lanh_dao: "Lãnh đạo",
  })[role] || role;

export default function KnowledgeCenter({ role, scenarioEnabled = false }: Props) {
  const admin = role === "admin_xa";
  const showScenarioSimulation = admin && scenarioEnabled;
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
  const [dataWarning, setDataWarning] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);

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
  const [evacuationPhone, setEvacuationPhone] = useState("");

  const refresh = async () => {
    setLoading(true);
    setError(null);
    setDataWarning(null);
    const requests: Promise<unknown>[] = [apiJson<Article[]>("/api/knowledge/articles"), apiJson<Champion[]>("/api/knowledge/champions"), apiJson<SupportPoint[]>("/api/knowledge/support-points")];
    const requestLabels = ["bài viết", "Đại sứ số", "điểm hỗ trợ"];
    const scenarioIndex = showScenarioSimulation ? requests.push(apiJson<Scenario[]>("/api/knowledge/scenarios")) - 1 : -1;
    if (scenarioIndex >= 0) requestLabels.push("kịch bản mô phỏng");
    // The officer directory contains staff contact data and is an administrator
    // capability. Leadership can still read published knowledge and evacuation
    // evidence without making an unauthorized or unnecessary directory request.
    const officerIndex = admin ? requests.push(apiJson<Officer[]>("/auth/officers")) - 1 : -1;
    if (officerIndex >= 0) requestLabels.push("danh sách cán bộ");
    const villageIndex = canViewEvacuation ? requests.push(loadVillages()) - 1 : -1;
    if (villageIndex >= 0) requestLabels.push("danh mục thôn");
    const evacuationIndex = canViewEvacuation ? requests.push(apiJson<EvacuationPoint[]>("/api/pilots/evacuation-points/admin")) - 1 : -1;
    if (evacuationIndex >= 0) requestLabels.push("điểm sơ tán");
    const results = await Promise.allSettled(requests);
    const assign = <T,>(index: number, setter: (value: T) => void) => {
      const result = results[index];
      if (result?.status === "fulfilled") setter(result.value as T);
      else setter([] as T);
    };
    assign<Article[]>(0, setArticles);
    assign<Champion[]>(1, setChampions);
    assign<SupportPoint[]>(2, setPoints);
    if (scenarioIndex >= 0) assign<Scenario[]>(scenarioIndex, setScenarios);
    else setScenarios([]);
    if (canViewEvacuation) {
      if (officerIndex >= 0) assign<Officer[]>(officerIndex, setOfficers);
      else setOfficers([]);
      const villageResult = results[villageIndex];
      if (villageResult?.status === "fulfilled")
        setVillages(
          (villageResult.value as Village[]).map(({ id, name }) => ({
            id,
            name,
          })),
        );
      else setVillages([]);
      assign<EvacuationPoint[]>(evacuationIndex, setEvacuationPoints);
    }
    const failedLabels = results.flatMap((result, index) =>
      result.status === "rejected" ? [requestLabels[index]] : [],
    );
    if (results.slice(0, 3).every((result) => result.status === "rejected")) {
      setError("Không tải được kho tri thức. Kiểm tra quyền truy cập hoặc kết nối rồi thử lại.");
    } else if (failedLabels.length > 0) {
      setDataWarning(
        `Đã tải được một phần dữ liệu nhưng chưa tải được: ${failedLabels.join(", ")}. Danh sách trống ở các mục này chưa phải kết luận không có dữ liệu.`,
      );
    }
    setLoading(false);
  };

  useEffect(() => {
    void refresh();
  }, [canViewEvacuation, showScenarioSimulation]);

  const submit = async (action: () => Promise<unknown>, success: string) => {
    try {
      await action();
      setNotice({ kind: "success", message: success });
      await refresh();
    } catch (caught) {
      setNotice({
        kind: "error",
        message: toUserFacingError(caught, "Không thể cập nhật. Vui lòng thử lại."),
      });
    }
  };

  const createArticle = () =>
    submit(async () => {
      if (!articleTitle.trim() || !articleBody.trim()) throw new Error("Hãy nhập đủ tiêu đề và nội dung tài liệu.");
      await apiJson<Article>("/api/knowledge/articles", {
        method: "POST",
        body: JSON.stringify({
          title: articleTitle.trim(),
          body: articleBody.trim(),
          category: "guidance",
          audience: "internal",
        }),
      });
      setArticleTitle("");
      setArticleBody("");
    }, "Đã lưu bài viết ở trạng thái bản nháp. Cán bộ xã phải duyệt trước khi trợ lý nội bộ sử dụng.");

  const approveArticle = (id: string) =>
    submit(
      () =>
        apiJson<Article>(`/api/knowledge/articles/${id}/approve`, {
          method: "POST",
        }),
      "Đã duyệt tài liệu. Chatbot nội bộ chỉ dùng nội dung đã duyệt có nguồn và phiên bản.",
    );

  const createChampion = () =>
    submit(async () => {
      if (!championUserId) throw new Error("Hãy chọn cán bộ phụ trách.");
      await apiJson<Champion>("/api/knowledge/champions", {
        method: "POST",
        body: JSON.stringify({
          user_id: championUserId,
          skills: splitValues(championSkills),
          support_schedule: championSchedule.trim() || null,
          supported_groups: championGroups.trim() || null,
        }),
      });
      setChampionUserId("");
      setChampionSkills("");
      setChampionSchedule("");
      setChampionGroups("");
    }, "Đã thêm Đại sứ số và ghi nhận người phụ trách.");

  const createPoint = () =>
    submit(async () => {
      if (!pointName.trim() || !pointAddress.trim()) throw new Error("Hãy nhập tên và địa chỉ điểm hỗ trợ.");
      await apiJson<SupportPoint>("/api/knowledge/support-points", {
        method: "POST",
        body: JSON.stringify({
          name: pointName.trim(),
          address: pointAddress.trim(),
          opening_hours: pointHours.trim() || null,
          equipment: splitValues(pointEquipment),
          champion_id: pointChampionId || null,
        }),
      });
      setPointName("");
      setPointAddress("");
      setPointHours("");
      setPointEquipment("");
      setPointChampionId("");
    }, "Đã thêm điểm hỗ trợ cộng đồng.");

  const createScenario = () =>
    submit(async () => {
      if (!scenarioName.trim()) throw new Error("Hãy nhập tên kịch bản.");
      await apiJson<Scenario>("/api/knowledge/scenarios", {
        method: "POST",
        body: JSON.stringify({ name: scenarioName.trim() }),
      });
      setScenarioName("");
    }, "Đã tạo kịch bản. Kết quả mô phỏng không ghi ngược vào dữ liệu báo cáo thật.");

  const runScenario = async (id: string) => {
    const values = [baselinePopulation, baselineBudget, baselineDemand, populationChange, budgetChange, demandChange].map(Number);
    if (values.some((item) => !Number.isFinite(item) || item < 0)) {
      setNotice({
        kind: "error",
        message: "Giá trị mô phỏng phải là số không âm.",
      });
      return;
    }
    setRunningScenario(id);
    try {
      const [population, budget, service_demand, population_change_pct, budget_change_pct, service_demand_change_pct] = values;
      const response = await apiJson<{
        result?: { projection?: Record<string, number> };
      }>(`/api/knowledge/scenarios/${id}/run`, {
        method: "POST",
        body: JSON.stringify({
          baseline: { population, budget, service_demand },
          assumptions: {
            population_change_pct,
            budget_change_pct,
            service_demand_change_pct,
          },
        }),
      });
      setScenarioResult(response.result?.projection || null);
      setNotice({
        kind: "success",
        message:
          "Đã chạy mô phỏng xác định từ các giả định đã nhập. Đây không phải dự báo AI.",
      });
    } catch (caught) {
      setNotice({
        kind: "error",
        message: toUserFacingError(caught, "Không thể chạy mô phỏng."),
      });
    } finally {
      setRunningScenario(null);
    }
  };

  const createEvacuationPoint = () =>
    submit(async () => {
      const latitude = Number(evacuationLatitude),
        longitude = Number(evacuationLongitude),
        capacity = Number(evacuationCapacity);
      if (!evacuationVillageId || !evacuationName.trim() || !Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isInteger(capacity) || capacity <= 0) throw new Error("Hãy nhập thôn, tên, tọa độ và sức chứa hợp lệ.");
      await apiJson<EvacuationPoint>("/api/pilots/evacuation-points", {
        method: "POST",
        body: JSON.stringify({
          village_id: evacuationVillageId,
          name: evacuationName.trim(),
          latitude,
          longitude,
          capacity_households: capacity,
          contact_name: evacuationContact.trim() || "Trực ban UBND xã",
          contact_phone: evacuationPhone.trim() || null,
        }),
      });
      setEvacuationName("");
      setEvacuationLatitude("");
      setEvacuationLongitude("");
      setEvacuationCapacity("");
    }, "Đã thêm điểm sơ tán ở trạng thái chờ xác minh. Chưa công khai cho người dân.");

  const toggleEvacuationPoint = (point: EvacuationPoint) =>
    submit(
      () =>
        apiJson<EvacuationPoint>(`/api/pilots/evacuation-points/${point.id}/verification`, {
          method: "PATCH",
          body: JSON.stringify({ is_verified: !point.is_verified }),
        }),
      point.is_verified ? "Đã ẩn điểm sơ tán khỏi cổng công khai." : "Đã duyệt và công bố điểm sơ tán.",
    );

  if (loading)
    return (
      <div role="status" className="flex min-h-64 items-center justify-center gap-2 text-sm text-slate-600">
        <Loader2 className="h-5 w-5 animate-spin text-emerald-800" />
        Đang tải kho tri thức…
      </div>
    );
  if (error) return <ErrorState description={error} onRetry={() => void refresh()} />;

  return (
    <div className="knowledge-page knowledge-hub space-y-6">
      <PageHeader
        eyebrow="TRI THỨC VÀ HỖ TRỢ"
        title="Kho tri thức và mạng lưới hỗ trợ"
        description={
          showScenarioSimulation
            ? "Tài liệu nghiệp vụ, mạng lưới hỗ trợ và điểm sơ tán; mô phỏng chỉ xuất hiện trong khu vực quản trị thử nghiệm."
            : canViewEvacuation
              ? "Tài liệu nghiệp vụ, mạng lưới hỗ trợ và điểm sơ tán được trình bày theo đúng phạm vi vai trò."
              : "Tài liệu nghiệp vụ và mạng lưới hỗ trợ dành cho cán bộ thôn."
        }
        actions={
          <Button variant="secondary" onClick={() => void refresh()}>
            <RotateCw />
            Làm mới
          </Button>
        }
      />
      {notice && (
        <div
          role={notice.kind === "error" ? "alert" : "status"}
          className={`rounded-lg border p-3 text-sm font-semibold ${
            notice.kind === "error"
              ? "border-rose-200 bg-rose-50 text-rose-900"
              : "border-emerald-200 bg-emerald-50 text-emerald-900"
          }`}
        >
          {notice.message}
        </div>
      )}
      {dataWarning && (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between" role="alert">
          <span>{dataWarning}</span>
          <Button type="button" variant="secondary" onClick={() => void refresh()}>
            <RotateCw />
            Thử tải lại
          </Button>
        </div>
      )}

      <SectionCard className="knowledge-section knowledge-section--articles">
        <SectionTitle tone="book" icon={<BookOpen />} title="Tài liệu nghiệp vụ" description="Nguồn đã duyệt để cán bộ và chatbot nội bộ tra cứu nhất quán." count={`${articles.length} tài liệu`} />
        <div className="knowledge-section__body">
          <div className="knowledge-article-list">
            {articles.length ? (
              articles.map((article) => (
                <article key={article.id} className="knowledge-article">
                  <div>
                    <p className="knowledge-article__meta">
                      {CATEGORY_LABELS[article.category] || article.category} · Phiên bản {article.version}
                    </p>
                    <h3>{article.title}</h3>
                    <p>
                      {article.summary ||
                        "Tóm tắt đang được quản trị nội dung hoàn thiện; liên hệ cán bộ xã để xem tài liệu gốc đã duyệt."}
                    </p>
                  </div>
                  <div className="knowledge-article__actions">
                    <StatusBadge status={article.status} label={article.status === "approved" ? "Đã duyệt" : "Bản nháp"} />
                    {admin && article.status !== "approved" && <Button onClick={() => void approveArticle(article.id)}>Duyệt tài liệu</Button>}
                  </div>
                </article>
              ))
            ) : (
              <EmptyState title="Chưa có tài liệu" description="Tạo bản nháp, rà soát nội dung rồi duyệt trước khi chatbot nội bộ sử dụng." />
            )}
          </div>
          {admin && (
            <Disclosure title="Soạn tài liệu mới" description="Tài liệu mới luôn được lưu ở trạng thái bản nháp để rà soát trước khi dùng.">
              <FormGrid>
                <Field label="Tiêu đề">
                  <input value={articleTitle} onChange={(event) => setArticleTitle(event.target.value)} placeholder="Ví dụ: Quy trình tiếp nhận phản ánh" />
                </Field>
                <Field label="Nội dung">
                  <textarea value={articleBody} onChange={(event) => setArticleBody(event.target.value)} placeholder="Nội dung nghiệp vụ đã được kiểm duyệt nội bộ" />
                </Field>
                <div className="form-action">
                  <Button onClick={() => void createArticle()} disabled={!articleTitle.trim() || !articleBody.trim()}>
                    <Plus />
                    Lưu bản nháp
                  </Button>
                </div>
              </FormGrid>
            </Disclosure>
          )}
        </div>
      </SectionCard>

      <div className="knowledge-two-column">
        <SectionCard className="knowledge-section knowledge-section--champions">
          <SectionTitle tone="people" icon={<Users />} title="Đại sứ số" description="Cán bộ hỗ trợ người dân và nhóm yếu thế tiếp cận dịch vụ số." count={`${champions.length} người`} />
          <div className="knowledge-section__body">
            {champions.length ? (
              <ItemList>
                {champions.map((champion) => (
                  <li key={champion.id}>
                    <div className="knowledge-item__title">{officers.find((officer) => officer.id === champion.user_id)?.name || "Cán bộ được phân công"}</div>
                    <div className="knowledge-detail-grid">
                      <div>
                        <span className="knowledge-detail-grid__label">Kỹ năng</span>
                        <span>{champion.skills?.join(", ") || (admin ? "Cần bổ sung trong mục phân công bên dưới" : "Chưa cập nhật — liên hệ quản trị xã")}</span>
                      </div>
                      <div>
                        <span className="knowledge-detail-grid__label">Lịch hỗ trợ</span>
                        <span>{champion.support_schedule || (admin ? "Cần bổ sung trong mục phân công bên dưới" : "Chưa cập nhật — liên hệ quản trị xã")}</span>
                      </div>
                      <div>
                        <span className="knowledge-detail-grid__label">Nhóm hỗ trợ</span>
                        <span>{champion.supported_groups || (admin ? "Cần bổ sung trong mục phân công bên dưới" : "Chưa cập nhật — liên hệ quản trị xã")}</span>
                      </div>
                    </div>
                  </li>
                ))}
              </ItemList>
            ) : (
              <EmptyState title="Chưa có Đại sứ số" description="Cán bộ xã chọn cán bộ trong danh sách để phân công hỗ trợ." />
            )}
            {admin && (
              <Disclosure title="Phân công Đại sứ số" description="Chọn cán bộ, kỹ năng và lịch hỗ trợ trước khi công bố nội bộ.">
                <FormGrid>
                  <Field label="Cán bộ phụ trách">
                    <select value={championUserId} onChange={(event) => setChampionUserId(event.target.value)}>
                      <option value="">Chọn cán bộ phụ trách</option>
                      {officers
                        .filter((officer) => officer.is_active && !champions.some((item) => item.user_id === officer.id))
                        .map((officer) => (
                          <option key={officer.id} value={officer.id}>
                            {officer.name || officer.id} · {roleLabel(officer.role)}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field label="Kỹ năng">
                    <input value={championSkills} onChange={(event) => setChampionSkills(event.target.value)} placeholder="Ví dụ: dịch vụ công trực tuyến, hỗ trợ người cao tuổi" />
                  </Field>
                  <Field label="Nhóm hỗ trợ">
                    <input value={championGroups} onChange={(event) => setChampionGroups(event.target.value)} placeholder="Ví dụ: người cao tuổi, hộ khó khăn" />
                  </Field>
                  <Field label="Lịch hỗ trợ">
                    <input value={championSchedule} onChange={(event) => setChampionSchedule(event.target.value)} placeholder="Ví dụ: Thứ 2–Thứ 6, 08:00–17:00" />
                  </Field>
                  <div className="form-action">
                    <Button onClick={() => void createChampion()} disabled={!championUserId}>
                      <Plus />
                      Xác nhận phân công
                    </Button>
                  </div>
                </FormGrid>
              </Disclosure>
            )}
          </div>
        </SectionCard>
        <SectionCard className="knowledge-section knowledge-section--points">
          <SectionTitle tone="location" icon={<MapPin />} title="Điểm hỗ trợ cộng đồng" description="Địa điểm, lịch trực và thiết bị dùng chung phục vụ người dân." count={`${points.length} điểm`} />
          <div className="knowledge-section__body">
            {points.length ? (
              <ItemList>
                {points.map((point) => (
                  <li key={point.id}>
                    <div className="knowledge-item__title">{point.name}</div>
                    <div className="knowledge-detail-grid">
                      <div>
                        <span className="knowledge-detail-grid__label">Địa chỉ</span>
                        <span>{point.address}</span>
                      </div>
                      <div>
                        <span className="knowledge-detail-grid__label">Lịch trực</span>
                        <span>{point.opening_hours || (admin ? "Cần bổ sung trong biểu mẫu quản trị bên dưới" : "Chưa cập nhật — liên hệ quản trị xã")}</span>
                      </div>
                      <div>
                        <span className="knowledge-detail-grid__label">Thiết bị</span>
                        <span>{point.equipment?.join(", ") || (admin ? "Cần bổ sung trong biểu mẫu quản trị bên dưới" : "Chưa cập nhật — liên hệ quản trị xã")}</span>
                      </div>
                      <div>
                        <span className="knowledge-detail-grid__label">Đại sứ số phụ trách</span>
                        <span>{point.champion_id ? "Đã phân công" : (admin ? "Cần phân công trong biểu mẫu bên dưới" : "Chưa phân công — liên hệ quản trị xã")}</span>
                      </div>
                    </div>
                  </li>
                ))}
              </ItemList>
            ) : (
              <EmptyState title="Chưa có điểm hỗ trợ" description="Cán bộ xã cấu hình địa điểm và thiết bị dùng chung trước khi công khai nội bộ." />
            )}
            {admin && (
              <Disclosure title="Thêm điểm hỗ trợ" description="Cấu hình thông tin tối thiểu để cán bộ biết nơi và thời gian hỗ trợ.">
                <FormGrid>
                  <Field label="Tên điểm hỗ trợ">
                    <input value={pointName} onChange={(event) => setPointName(event.target.value)} placeholder="Ví dụ: Nhà văn hóa thôn An Sơn" />
                  </Field>
                  <Field label="Địa chỉ">
                    <input value={pointAddress} onChange={(event) => setPointAddress(event.target.value)} placeholder="Thôn An Sơn, xã Bà Nà" />
                  </Field>
                  <Field label="Lịch trực">
                    <input value={pointHours} onChange={(event) => setPointHours(event.target.value)} placeholder="VD: Thứ 2–Thứ 6, 08:00–17:00" />
                  </Field>
                  <Field label="Thiết bị">
                    <input value={pointEquipment} onChange={(event) => setPointEquipment(event.target.value)} placeholder="VD: Máy tính, máy quét" />
                  </Field>
                  <Field label="Đại sứ số phụ trách">
                    <select value={pointChampionId} onChange={(event) => setPointChampionId(event.target.value)}>
                      <option value="">Chưa phân công</option>
                      {champions.map((champion) => (
                        <option key={champion.id} value={champion.id}>
                          {officers.find((officer) => officer.id === champion.user_id)?.name || champion.id}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <div className="form-action">
                    <Button onClick={() => void createPoint()} disabled={!pointName.trim() || !pointAddress.trim()}>
                      <Plus />
                      Lưu điểm hỗ trợ
                    </Button>
                  </div>
                </FormGrid>
              </Disclosure>
            )}
          </div>
        </SectionCard>
      </div>

      {canViewEvacuation && (
        <SectionCard className="knowledge-section knowledge-section--evacuation">
          <SectionTitle tone="location" icon={<MapPin />} title="Điểm sơ tán" description="Cán bộ xã rà soát hồ sơ và quyết định công bố; lãnh đạo theo dõi. Chỉ điểm đã được duyệt mới xuất hiện trên cổng công khai." count={`${evacuationPoints.length} điểm`} />
          <div className="knowledge-section__body">
            {evacuationPoints.length ? (
              <ItemList>
                {evacuationPoints.map((point) => (
                  <li key={point.id}>
                    <div className="knowledge-item__top">
                      <strong>{point.name}</strong>
                      <StatusBadge status={point.is_verified ? "approved" : "draft"} label={point.is_verified ? "Đã công bố" : "Chờ duyệt"} />
                    </div>
                    <div className="knowledge-detail-grid">
                      <span>
                        <b>Phạm vi</b>
                        {villages.find((village) => village.id === point.village_id)?.name || "Chưa xác định thôn"}
                      </span>
                      <span>
                        <b>Sức chứa</b>
                        {point.capacity_households.toLocaleString("vi-VN")} hộ
                      </span>
                      <span>
                        <b>Tọa độ</b>
                        {point.latitude}, {point.longitude} ·{" "}
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${point.latitude},${point.longitude}`}
                          target="_blank"
                          rel="noreferrer"
                          className="font-bold text-emerald-800 underline"
                        >
                          Mở bản đồ
                        </a>
                      </span>
                    </div>
                    {admin && (
                      <div className="mt-3">
                        <Button variant="secondary" onClick={() => void toggleEvacuationPoint(point)}>
                          {point.is_verified ? "Ẩn khỏi công khai" : "Duyệt và công khai"}
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ItemList>
            ) : (
              <EmptyState title="Chưa có điểm sơ tán" description="Chỉ thêm sau khi có nguồn, vị trí và đầu mối chính thức." />
            )}
            {admin && (
              <Disclosure title="Tạo điểm sơ tán chờ xác minh" description="Điểm chỉ được công khai sau khi người có thẩm quyền xác minh.">
                <FormGrid>
                  <Field label="Thôn">
                    <select value={evacuationVillageId} onChange={(event) => setEvacuationVillageId(event.target.value)}>
                      <option value="">Chọn thôn</option>
                      {villages.map((village) => (
                        <option key={village.id} value={village.id}>
                          {village.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Tên điểm sơ tán">
                    <input value={evacuationName} onChange={(event) => setEvacuationName(event.target.value)} placeholder="Ví dụ: Nhà văn hóa thôn" />
                  </Field>
                  <Field label="Vĩ độ">
                    <input type="number" min="-90" max="90" step="any" value={evacuationLatitude} onChange={(event) => setEvacuationLatitude(event.target.value)} placeholder="Ví dụ: 15.95" />
                  </Field>
                  <Field label="Kinh độ">
                    <input type="number" min="-180" max="180" step="any" value={evacuationLongitude} onChange={(event) => setEvacuationLongitude(event.target.value)} placeholder="Ví dụ: 108.12" />
                  </Field>
                  <Field label="Sức chứa (hộ)">
                    <input type="number" min="1" value={evacuationCapacity} onChange={(event) => setEvacuationCapacity(event.target.value)} />
                  </Field>
                  <Field label="Đầu mối nội bộ">
                    <input value={evacuationContact} onChange={(event) => setEvacuationContact(event.target.value)} placeholder="Ví dụ: Trực ban UBND xã" />
                  </Field>
                  <Field label="Số điện thoại nội bộ (nếu đã được phê duyệt)">
                    <input type="tel" inputMode="tel" value={evacuationPhone} onChange={(event) => setEvacuationPhone(event.target.value)} placeholder="Bỏ trống nếu chưa có số chính thức" />
                  </Field>
                  <div className="form-action">
                    <Button onClick={() => void createEvacuationPoint()}>
                      <Plus />
                      Lưu điểm chờ xác minh
                    </Button>
                  </div>
                </FormGrid>
              </Disclosure>
            )}
          </div>
        </SectionCard>
      )}

      {showScenarioSimulation && (
        <SectionCard className="knowledge-section knowledge-section--scenarios">
          <SectionTitle tone="scenario" icon={<Database />} title="Mô phỏng phương án" description="Thử giả định trên dữ liệu nền; đây không phải dự báo và không thay đổi dữ liệu báo cáo thật." count={`${scenarios.length} phương án`} />
          <div className="knowledge-section__body">
            <div className="scenario-inputs">
              <p>Thông số dùng để mô phỏng</p>
              <div className="scenario-inputs__grid">
                <Field label="Dân số nền">
                  <input type="number" min="0" value={baselinePopulation} onChange={(event) => setBaselinePopulation(event.target.value)} />
                </Field>
                <Field label="Ngân sách nền">
                  <input type="number" min="0" value={baselineBudget} onChange={(event) => setBaselineBudget(event.target.value)} />
                </Field>
                <Field label="Nhu cầu dịch vụ nền">
                  <input type="number" min="0" value={baselineDemand} onChange={(event) => setBaselineDemand(event.target.value)} />
                </Field>
                <Field label="Thay đổi dân số (%)">
                  <input type="number" min="0" value={populationChange} onChange={(event) => setPopulationChange(event.target.value)} />
                </Field>
                <Field label="Thay đổi ngân sách (%)">
                  <input type="number" min="0" value={budgetChange} onChange={(event) => setBudgetChange(event.target.value)} />
                </Field>
                <Field label="Thay đổi nhu cầu (%)">
                  <input type="number" min="0" value={demandChange} onChange={(event) => setDemandChange(event.target.value)} />
                </Field>
              </div>
            </div>
            <div className="scenario-list">
              {scenarios.length ? (
                scenarios.map((scenario) => (
                  <article key={scenario.id} className="scenario-card">
                    <div>
                      <h3>{scenario.name}</h3>
                      <p>{scenario.description || "Chưa có mô tả."}</p>
                    </div>
                    {admin && (
                      <Button onClick={() => void runScenario(scenario.id)} disabled={runningScenario === scenario.id}>
                        {runningScenario === scenario.id ? <Loader2 className="animate-spin" /> : <Sparkles />}
                        Chạy mô phỏng
                      </Button>
                    )}
                  </article>
                ))
              ) : (
                <EmptyState title="Chưa có kịch bản" description="Cán bộ xã tạo kịch bản để thử các giả định dân số, ngân sách hoặc nhu cầu dịch vụ." />
              )}
            </div>
            {scenarioResult && (
              <div className="knowledge-result">
                <strong>Kết quả mô phỏng</strong>
                <span>
                  {Object.entries(scenarioResult)
                    .map(([key, value]) => `${labelProjection(key)}: ${Number(value).toLocaleString("vi-VN")}`)
                    .join(" · ")}
                </span>
              </div>
            )}
            {admin && (
              <Disclosure title="Tạo kịch bản mới" description="Đặt tên rõ ràng để so sánh các phương án sau này.">
                <div className="scenario-create">
                  <input value={scenarioName} onChange={(event) => setScenarioName(event.target.value)} placeholder="Ví dụ: Tăng nhu cầu dịch vụ 10%" />
                  <Button onClick={() => void createScenario()} disabled={!scenarioName.trim()}>
                    <Plus />
                    Tạo kịch bản
                  </Button>
                </div>
              </Disclosure>
            )}
          </div>
        </SectionCard>
      )}
    </div>
  );
}

function SectionTitle({ icon, title, description, count, tone }: { icon: ReactNode; title: string; description: string; count: string; tone: "book" | "people" | "location" | "scenario" }) {
  return (
    <div className="knowledge-section__header">
      <span className={`knowledge-section__icon knowledge-section__icon--${tone}`}>{icon}</span>
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      <span className="knowledge-section__count">{count}</span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm font-semibold text-slate-700">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}

function FormGrid({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`knowledge-form-grid ${className}`}>{children}</div>;
}

function ItemList({ children }: { children: ReactNode }) {
  return <ul className="knowledge-list">{children}</ul>;
}

function Disclosure({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <details className="knowledge-disclosure">
      <summary>
        <span>
          <b>{title}</b>
          <small>{description}</small>
        </span>
        <Plus aria-hidden="true" />
      </summary>
      <div className="knowledge-disclosure__body">{children}</div>
    </details>
  );
}

function splitValues(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
function labelProjection(key: string) {
  return (
    {
      population: "Dân số",
      budget: "Ngân sách",
      service_demand: "Nhu cầu dịch vụ",
    }[key] || key
  );
}
