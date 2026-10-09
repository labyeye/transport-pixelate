import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Eye, Paperclip, Trash2, Upload } from "lucide-react";
import { Modal } from "@/components/common/Modal";
import { del, get, openFile, upload } from "@/services/api";
import { useToast } from "@/hooks/use-toast";
import { errMsg } from "@/lib/errors";

/** Files attached to one record (expense receipt, maintenance invoice, ...). */
export function Attachments({
  ownerType,
  owner,
  title,
  canWrite,
  onClose,
  docType = "receipt",
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const input = useRef(null);
  const [error, setError] = useState("");
  const key = ["attachments", ownerType, owner];
  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: async () =>
      (await get("/documents", { ownerType, owner, limit: 50 })).data,
  });
  const add = useMutation({
    mutationFn: (file) => {
      const f = new FormData();
      f.append("ownerType", ownerType);
      f.append("owner", owner);
      f.append("type", docType);
      f.append("file", file);
      return upload("/documents", f);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
      setError("");
    },
    onError: (e) => setError(errMsg(e)),
  });
  const remove = useMutation({
    mutationFn: (id) => del(`/documents/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
  const open = (d, download) =>
    openFile(`/documents/${d._id}/file`, {
      download,
      name: d.file.originalName,
    }).catch((e) =>
      toast({
        title: "Can't open file",
        description: errMsg(e),
        variant: "destructive",
      }),
    );
  return (
    <Modal title={title} onClose={onClose}>
      {error && (
        <div
          role="alert"
          className="border-2 border-[#EF4444] bg-red-50 p-2.5 text-sm font-semibold text-red-700 mb-3"
        >
          {error}
        </div>
      )}
      <ul className="border-2 border-black divide-y divide-black/10 mb-3">
        {isLoading && <li className="px-3 py-3 text-sm">Loading…</li>}
        {!isLoading && !data?.length && (
          <li className="px-3 py-3 text-sm text-muted-foreground">
            No files attached.
          </li>
        )}
        {data?.map((d) => (
          <li
            key={d._id}
            className="px-3 py-2 flex items-center justify-between gap-2 text-sm"
          >
            <span className="truncate font-semibold">
              {d.file.originalName}
            </span>
            <span className="flex gap-1 shrink-0">
              <button
                aria-label="View"
                onClick={() => open(d, false)}
                className="border-2 border-black p-1.5"
              >
                <Eye className="w-3.5 h-3.5" />
              </button>
              <button
                aria-label="Download"
                onClick={() => open(d, true)}
                className="border-2 border-black p-1.5"
              >
                <Download className="w-3.5 h-3.5" />
              </button>
              {canWrite && (
                <button
                  aria-label="Remove"
                  onClick={() => remove.mutate(d._id)}
                  className="border-2 border-black p-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5 text-red-600" />
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {canWrite && (
        <>
          <input
            ref={input}
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) add.mutate(f);
              e.target.value = "";
            }}
          />
          <button
            disabled={add.isPending}
            onClick={() => input.current?.click()}
            className="border-2 border-black bg-[#024BAB] text-white px-3 py-2 text-sm font-bold flex items-center gap-1.5 disabled:opacity-50"
          >
            <Upload className="w-4 h-4" />{" "}
            {add.isPending ? "Uploading…" : "Attach file"}
          </button>
          <p className="text-xs text-muted-foreground font-medium mt-2">
            PDF, JPEG, PNG or WebP, up to 10 MB.
          </p>
        </>
      )}
    </Modal>
  );
}

export const AttachButton = ({ onClick, label = "Files" }) => (
  <button
    onClick={onClick}
    title={label}
    aria-label={label}
    className="border-2 border-black p-1.5 hover:bg-[#024BAB]/10"
  >
    <Paperclip className="w-3.5 h-3.5" />
  </button>
);
