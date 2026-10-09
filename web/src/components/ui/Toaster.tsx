import { X, CheckCircle, AlertCircle, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export function Toaster() {
  const { toasts, dismiss } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)]">
      {toasts.map((t) => {
        const isDestructive = t.variant === "destructive";
        const isSuccess = t.variant === "success";

        return (
          <div
            key={t.id}
            className={cn(
              "flex items-start gap-3 p-4 border-2 border-black bg-white animate-in slide-in-from-bottom-2 duration-200",
              isDestructive && "border-red-500 bg-red-50",
              isSuccess && "border-green-500 bg-green-50",
            )}
          >
            <div className="shrink-0 mt-0.5">
              {isDestructive ? (
                <AlertCircle className="w-4 h-4 text-red-600" />
              ) : isSuccess ? (
                <CheckCircle className="w-4 h-4 text-green-600" />
              ) : (
                <Info className="w-4 h-4 text-[#024BAB]" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              {t.title && (
                <p
                  className={cn(
                    "text-sm font-bold",
                    isDestructive && "text-red-800",
                    isSuccess && "text-green-800",
                  )}
                >
                  {t.title}
                </p>
              )}
              {t.description && (
                <p
                  className={cn(
                    "text-xs font-medium mt-0.5",
                    isDestructive
                      ? "text-red-700"
                      : isSuccess
                        ? "text-green-700"
                        : "text-gray-600",
                  )}
                >
                  {t.description}
                </p>
              )}
            </div>
            <button
              onClick={() => dismiss(t.id)}
              className="shrink-0 p-0.5 hover:bg-black/10 transition-colors"
            >
              <X className="w-3.5 h-3.5 text-gray-500" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
