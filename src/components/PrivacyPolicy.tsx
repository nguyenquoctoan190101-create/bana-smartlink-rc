import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
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
  { code: "CT13", name: "Số người dân được hướng dẫn dùng dịch vụ công trực tuyến trong kỳ", unit: "Người" },
  { code: "CT14", name: "Số vụ bạo lực gia đình ghi nhận trong kỳ", unit: "Vụ" },
];

const ROLES_INFO = [
  {
    role: "Quản trị viên xã",
    desc: "Quản lý kỳ/tài khoản; xem toàn xã; duyệt, khóa, công bố và xuất báo cáo.",
  },
  {
    role: "Lãnh đạo xã",
    desc: "Chỉ xem bảng điều hành và báo cáo nội bộ; được xuất báo cáo nhưng không được thay đổi dữ liệu.",
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
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const isOpen = propIsOpen !== undefined ? propIsOpen : localIsOpen;
  const isModalOnlyActive = isModalOnly || isModal;
  const handleClose = useCallback(() => {
    if (onClose) onClose();
    else setLocalIsOpen(false);
  }, [onClose]);
  const handleOpen = () => setLocalIsOpen(true);

  const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
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

    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : triggerRef.current;
    closeButtonRef.current?.focus();

    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previouslyFocusedRef.current?.focus();
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
            Thông báo bảo vệ dữ liệu cá nhân và quyền riêng tư
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
              Thông báo bảo vệ dữ liệu cá nhân và quyền riêng tư
            </h2>
            <button
              type="button"
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
              Phiên bản 1.0 · cập nhật ngày 26/7/2026 · áp dụng cho giai đoạn vận hành thử nghiệm
            </div>

            <p>
              Ủy ban nhân dân xã Bà Nà là đơn vị quản lý dữ liệu trong phạm vi vận hành
              <strong> Ba Na SmartLink</strong>. Thông báo này nêu rõ dữ liệu được tiếp nhận,
              mục đích sử dụng, phạm vi truy cập và cách gửi yêu cầu liên quan đến dữ liệu cá nhân.
            </p>

            <h3>1. Chúng tôi thu thập dữ liệu gì?</h3>
            <p>
              Hệ thống lưu hồ sơ cán bộ (họ tên, số điện thoại, vai trò, thôn được giao). Khi người
              dân gửi đề nghị đối chiếu, hệ thống nhận số điện thoại để liên hệ, họ tên nếu người
              gửi tự nguyện cung cấp và nội dung cần kiểm tra. <strong>Thông tin liên hệ không được
              gửi tới dịch vụ AI bên ngoài.</strong>
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
              dữ liệu cục bộ của tài khoản hiện tại được xóa. Khi cán bộ chủ động dùng chức năng OCR,
              hệ thống chỉ gửi ảnh vùng bảng CT01–CT14 sau khi đã cắt bỏ phần họ tên, số điện thoại và
              thông tin đầu biểu mẫu. Chức năng diễn giải chỉ gửi CT01–CT13; CT14 được loại trước khi
              gửi. Dịch vụ xử lý AI bên ngoài được cấu hình là Google Gemini. Kết quả luôn cần cán bộ
              xác nhận và không quyết định tính hợp lệ của báo cáo.
            </p>
            <p>
              Thời hạn lưu báo cáo, kiến nghị, nhật ký kiểm toán và bản sao lưu phải được UBND xã phê
              duyệt và cấu hình trước khi đưa vào sử dụng; chức năng thử nghiệm không tự động cam kết hoặc áp dụng
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
              Người dùng có thể gửi yêu cầu xem, điều chỉnh, hạn chế xử lý hoặc xóa thông tin liên hệ.
              Yêu cầu được xem xét theo căn cứ pháp luật, thẩm quyền và thời hạn lưu hồ sơ đã được phê duyệt.
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
