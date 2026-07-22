import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import "./PrivacyPolicy.css";

/* ─────────────────────────── Constants ──────────────────────────────── */

const INDICATORS = [
  { code: "CT01", name: "Tổng số hộ dân", unit: "Hộ" },
  { code: "CT02", name: "Tổng số nhân khẩu", unit: "Người" },
  { code: "CT03", name: "Số hộ nghèo", unit: "Hộ" },
  { code: "CT04", name: "Số hộ cận nghèo", unit: "Hộ" },
  { code: "CT05", name: "Số người có công với cách mạng đang được quản lý", unit: "Người" },
  { code: "CT06", name: "Số đối tượng bảo trợ xã hội đang hưởng trợ cấp", unit: "Người" },
  { code: "CT07", name: "Số trẻ em dưới 16 tuổi", unit: "Người" },
  { code: "CT08", name: "Số trẻ em có hoàn cảnh đặc biệt", unit: "Người" },
  { code: "CT09", name: "Số hộ đạt \"Gia đình văn hóa\"", unit: "Hộ" },
  { code: "CT10", name: "Số người trong độ tuổi lao động", unit: "Người" },
  { code: "CT11", name: "Số người tham gia BHYT", unit: "Người" },
  { code: "CT12", name: "Số thành viên Tổ công nghệ số cộng đồng", unit: "Người" },
  { code: "CT13", name: "Số người dân được hướng dẫn dùng DVC trực tuyến trong kỳ", unit: "Người" },
  { code: "CT14", name: "Số vụ bạo lực gia đình ghi nhận trong kỳ", unit: "Vụ" },
];

const ROLES_INFO = [
  {
    role: "Quản trị viên xã",
    desc: "Quản lý kỳ/tài khoản; xem toàn xã; duyệt, khóa, công bố và xuất báo cáo.",
  },
  {
    role: "Lãnh đạo xã",
    desc: "Chỉ đọc dashboard và báo cáo nội bộ; được xuất báo cáo nhưng không được thay đổi dữ liệu.",
  },
  {
    role: "Cán bộ thôn",
    desc: "Nhập liệu, chỉnh sửa và theo dõi báo cáo thuộc thôn mình quản lý.",
  },
  {
    role: "Tổ công nghệ số cộng đồng",
    desc: "Hỗ trợ cán bộ thôn nhập số liệu (không trực tiếp sở hữu báo cáo).",
  },
  {
    role: "Người dân",
    desc: "Chỉ xem CT01, CT02, CT09, CT12 và CT13 đã được công bố; không thể xem CT14.",
  },
];

/* ─────────────────────────── Component ─────────────────────────────── */

interface PrivacyPolicyProps {
  isModalOnly?: boolean;
  isModal?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
}

export default function PrivacyPolicy({ isModalOnly = false, isModal = false, isOpen: propIsOpen, onClose }: PrivacyPolicyProps = {}) {
  const [localIsOpen, setLocalIsOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const isOpen = propIsOpen !== undefined ? propIsOpen : localIsOpen;
  const isModalOnlyActive = isModalOnly || isModal;
  const handleClose = onClose || (() => setLocalIsOpen(false));
  const handleOpen = () => setLocalIsOpen(true);

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ) as HTMLElement[];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  // Close modal when pressing Escape key
  useEffect(() => {
    if (!isOpen) return;

    closeButtonRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      triggerRef.current?.focus();
    };
  }, [isOpen, handleClose]);

  return (
    <>
      {!isModalOnlyActive && (
        <footer className="privacy-policy-footer" role="contentinfo">
          <button
            id="privacy-policy-open-link"
            className="privacy-policy-footer__link"
            aria-haspopup="dialog"
            ref={triggerRef}
            onClick={handleOpen}
          >
            Chính sách bảo mật thông tin & Quyền dữ liệu
          </button>
        </footer>
      )}

      {/* Privacy Policy Modal */}
      {isOpen && (
      <div
        id="privacy-policy-modal-overlay"
        className="privacy-policy-modal privacy-policy-modal--visible"
        onClick={handleClose}
      >
        <div
          ref={dialogRef}
          className="privacy-policy-modal__container"
          role="dialog"
          aria-modal="true"
          aria-labelledby="privacy-policy-title"
          onKeyDown={handleDialogKeyDown}
          onClick={(e) => e.stopPropagation()} // Prevent overlay close when clicking container
        >
          {/* Header */}
          <header className="privacy-policy-modal__header">
            <h2 id="privacy-policy-title" className="privacy-policy-modal__title">
              Cam kết Bảo mật & Quyền của Bạn
            </h2>
            <button
              id="privacy-policy-close-btn"
              className="privacy-policy-modal__close-btn"
              ref={closeButtonRef}
              aria-label="Đóng bảng chính sách"
              onClick={handleClose}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </header>

          {/* Scrollable Content */}
          <div className="privacy-policy-modal__content">
            <div className="privacy-policy-modal__law-tag" role="note">
              Dự thảo thông báo quyền riêng tư — phải được đơn vị pháp lý/phụ trách dữ liệu rà soát trước khi dùng dữ liệu thật.
            </div>

            <p>
              Chào bạn! Để hệ thống <strong>Ba Na SmartLink</strong> vận hành hiệu quả và minh
              bạch, chúng tôi cam kết bảo vệ dữ liệu của bạn bằng ngôn từ rõ ràng nhất, không dùng
              ngôn ngữ pháp lý phức tạp.
            </p>

            <h3>1. Chúng tôi thu thập dữ liệu gì?</h3>
            <p>
              Hệ thống lưu hồ sơ cán bộ (họ tên, số điện thoại, vai trò, thôn được giao) và có thể
              nhận thông tin người dân tự nguyện cung cấp khi gửi kiến nghị (số điện thoại, họ tên,
              hộ gia đình, địa chỉ, quan hệ và nội dung giải trình). <strong>Thông tin định danh và
              CT14 không được gửi lên Gemini.</strong>
            </p>
            <p>Chúng tôi thu thập đúng 14 chỉ tiêu thống kê cấp thôn sau:</p>

            <ul className="privacy-policy-modal__indicators">
              {INDICATORS.map((ind) => (
                <li key={ind.code} className="privacy-policy-modal__indicator-item">
                  <strong>{ind.code}</strong>: {ind.name} ({ind.unit})
                </li>
              ))}
            </ul>

            <h3>2. Dữ liệu dùng để làm gì?</h3>
            <p>
              Mọi số liệu thu thập được chỉ sử dụng để tổng hợp báo cáo kinh tế - xã hội của địa phương
              và hỗ trợ công tác quản lý an sinh xã hội tại xã Ba Na, không sử dụng cho mục đích thương
              mại hoặc quảng cáo.
            </p>

            <h3>3. Lưu trữ cục bộ, AI và thời hạn lưu</h3>
            <p>
              Trình duyệt chỉ lưu bản nháp và hàng đợi đồng bộ theo từng tài khoản trong IndexedDB;
              tên và số điện thoại người lập không được sao chép vào bộ nhớ ngoại tuyến. Khi đăng xuất,
              dữ liệu cục bộ của tài khoản hiện tại được xóa. Gemini chỉ được dùng cho OCR/diễn giải sau
              khi loại vùng thông tin cá nhân; kết quả luôn cần người dùng xác nhận và không quyết định
              tính hợp lệ của báo cáo.
            </p>
            <p>
              Thời hạn lưu báo cáo, kiến nghị, nhật ký kiểm toán và bản sao lưu phải được UBND xã phê
              duyệt và cấu hình trước khi vận hành thật; bản thử nghiệm không tự động hứa hoặc áp dụng
              một thời hạn chưa được phê duyệt.
            </p>

            <h3>4. Ai được quyền xem dữ liệu?</h3>
            <p>
              Dữ liệu được phân quyền truy cập chặt chẽ để bảo mật thông tin như sau:
            </p>

            <table className="privacy-policy-modal__roles" aria-label="Bảng phân quyền truy cập">
              <thead>
                <tr>
                  <th scope="col">Vai trò người dùng</th>
                  <th scope="col">Quyền truy cập dữ liệu</th>
                </tr>
              </thead>
              <tbody>
                {ROLES_INFO.map((info) => (
                  <tr key={info.role}>
                    <th scope="row" style={{ fontWeight: 650 }}>{info.role}</th>
                    <td>{info.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h3>5. Quyền kiểm soát và xử lý sự cố</h3>
            <p>
              Bạn có quyền yêu cầu xem lại, điều chỉnh hoặc rút/xóa thông tin liên hệ của mình khỏi
              hệ thống bất kỳ lúc nào.
            </p>
            <p>
              Khi nghi ngờ lộ dữ liệu, người dùng có thể báo trực tiếp cho bộ phận tiếp nhận của UBND
              xã. Đơn vị vận hành sẽ cô lập hệ thống, thu hồi phiên/khóa liên quan, bảo toàn nhật ký và
              thông báo phạm vi ảnh hưởng theo quy trình sự cố đã được phê duyệt.
            </p>

            <div className="privacy-policy-modal__contact-box">
              <p style={{ margin: 0 }}>
                <strong>Liên hệ hỗ trợ:</strong> Gửi yêu cầu trực tiếp tại bộ phận tiếp nhận của Ủy ban nhân dân
                xã Bà Nà hoặc qua chức năng phản ánh trong hệ thống. Thời hạn xử lý được thông báo theo từng yêu cầu.
              </p>
            </div>
          </div>
        </div>
      </div>
      )}
    </>
  );
}
