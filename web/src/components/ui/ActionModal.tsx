import { useEffect } from "react";
import { CheckCircle, AlertCircle, X } from "lucide-react";

interface ActionModalProps {
  show: boolean;
  type: "success" | "error";
  title: string;
  message: string;
  onClose: () => void;
  autoCloseMs?: number;
}

export function ActionModal({
  show,
  type,
  title,
  message,
  onClose,
  autoCloseMs = 2000,
}: ActionModalProps) {
  useEffect(() => {
    if (show && type === "success" && autoCloseMs > 0) {
      const t = setTimeout(onClose, autoCloseMs);
      return () => clearTimeout(t);
    }
  }, [show, type, autoCloseMs, onClose]);

  if (!show) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4"
      style={{ animation: "fadeIn 0.15s ease-out" }}
    >
      <div
        className="border-2 border-black bg-white w-full max-w-sm p-8 flex flex-col items-center justify-center text-center relative"
        style={{ animation: "slideUp 0.2s ease-out" }}
      >
        {type === "error" && (
          <button
            onClick={onClose}
            className="absolute top-3 right-3 p-1 hover:bg-gray-100 border border-transparent hover:border-black transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}

        {type === "success" ? (
          <>
            <div
              className="mb-4"
              style={{ animation: "bounceIn 0.4s ease-out" }}
            >
              <CheckCircle className="w-16 h-16 text-[#00C48C]" />
            </div>
            <h2 className="text-xl font-bold text-black mb-2">{title}</h2>
            <p className="text-sm text-muted-foreground mb-5">{message}</p>
            <div className="flex gap-2">
              <div className="w-2 h-2 bg-[#00C48C] rounded-full animate-pulse" />
              <div className="w-2 h-2 bg-[#00C48C] rounded-full animate-pulse [animation-delay:150ms]" />
              <div className="w-2 h-2 bg-[#00C48C] rounded-full animate-pulse [animation-delay:300ms]" />
            </div>
          </>
        ) : (
          <>
            <div
              className="mb-4"
              style={{ animation: "bounceIn 0.4s ease-out" }}
            >
              <AlertCircle className="w-16 h-16 text-[#EF4444]" />
            </div>
            <h2 className="text-xl font-bold text-black mb-2">{title}</h2>
            <p className="text-sm text-muted-foreground mb-6">{message}</p>
            <button
              onClick={onClose}
              className="px-6 py-2 bg-[#EF4444] text-white text-sm font-bold border-2 border-black hover:bg-[#EF4444]/90 transition-colors"
            >
              Dismiss
            </button>
          </>
        )}
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(16px) } to { opacity: 1; transform: translateY(0) } }
        @keyframes bounceIn {
          0% { transform: scale(0.3); opacity: 0 }
          50% { transform: scale(1.1) }
          70% { transform: scale(0.95) }
          100% { transform: scale(1); opacity: 1 }
        }
      `}</style>
    </div>
  );
}
