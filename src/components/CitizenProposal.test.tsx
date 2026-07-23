import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CitizenProposal from "./CitizenProposal";

vi.mock("../lib/useVillages", () => ({ useVillages: () => ({ villages: [{ id: "village-1", name: "Thôn mẫu" }] }) }));
vi.mock("../lib/apiClient", () => ({ apiFetch: vi.fn() }));

describe("citizen proposal workflow", () => {
  beforeEach(() => vi.clearAllMocks());

  it("moves through the three review steps before submission", async () => {
    const user = userEvent.setup();
    render(<CitizenProposal reports={[{ id: "report-1", village_id: "village-1", report_period: "Tháng 7/2026" }]} onProposalSubmitted={() => undefined} />);

    await user.type(screen.getByLabelText("Giá trị đề xuất"), "125");
    await user.type(screen.getByLabelText("Lý do cần đối chiếu"), "Số liệu cần cán bộ đối chiếu lại.");
    await user.click(screen.getByRole("button", { name: "Tiếp tục" }));

    const nameInput = screen.getByLabelText(/Họ và tên/);
    const householdInput = screen.getByLabelText(/Số nhà \/ hộ/);
    const addressInput = screen.getByLabelText(/Địa chỉ chi tiết/);

    expect(nameInput).toHaveAttribute("type", "text");
    expect(nameInput).toHaveAttribute("placeholder", "Ví dụ: Nguyễn Văn A");
    expect(householdInput).toHaveAttribute("type", "text");
    expect(addressInput).toHaveAttribute("type", "text");

    await user.type(nameInput, "Người dân mẫu");
    await user.type(screen.getByLabelText(/Số điện thoại/), "0900000000");
    await user.type(householdInput, "Hộ tổng hợp 01");
    await user.type(addressInput, "Địa chỉ tổng hợp");
    await user.click(screen.getByRole("button", { name: "Tiếp tục" }));

    expect(screen.getByText("Xác nhận nội dung")).toBeInTheDocument();
    expect(screen.getByText(/Thôn mẫu · Tháng 7\/2026 · CT01/)).toBeInTheDocument();
  }, 10_000);

  it("separates public-data corrections from field reports", async () => {
    const user = userEvent.setup();
    const openFieldReport = vi.fn();
    render(<CitizenProposal reports={[]} onProposalSubmitted={() => undefined} onOpenFieldReport={openFieldReport} />);

    expect(screen.getByText("Chỉ dành cho 5 chỉ tiêu đã công khai")).toBeInTheDocument();
    expect(screen.getByText(/đường, điện, nước, rác thải/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Phản ánh hiện trường" }));
    expect(openFieldReport).toHaveBeenCalledOnce();
  });
});
