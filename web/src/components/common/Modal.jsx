import { X } from "lucide-react";
import { useEffect } from "react";
export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const h = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`border-2 border-black bg-white w-full ${wide ? "max-w-2xl" : "max-w-md"} max-h-[90vh] flex flex-col`}
        style={{ animation: "page-fade-in 0.2s ease-out both" }}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b-2 border-black bg-[#024BAB]">
          <h3 className="font-bold text-white">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 overflow-auto">{children}</div>
      </div>
    </div>
  );
}
export function ConfirmationDialog({
  title,
  message,
  confirmLabel,
  danger,
  busy,
  onConfirm,
  onClose,
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <p className="text-sm text-black mb-5">{message}</p>
      <div className="flex justify-end gap-2">
        <button
          onClick={onClose}
          className="border-2 border-black bg-white px-4 py-2 text-sm font-bold"
        >
          Cancel
        </button>
        <button
          disabled={busy}
          onClick={onConfirm}
          className={`border-2 border-black px-4 py-2 text-sm font-bold text-white disabled:opacity-50 ${danger ? "bg-[#EF4444]" : "bg-[#024BAB]"}`}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
