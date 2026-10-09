import { useLocation } from "react-router-dom";
import { useEffect, useRef } from "react";

export default function PageTransition({
  children,
}: {
  children: React.ReactNode;
}) {
  const location = useLocation();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.classList.remove("page-transition");
    void el.offsetWidth;
    el.classList.add("page-transition");
  }, [location.pathname]);

  return (
    <div ref={ref} className="page-transition" style={{ minHeight: "100%" }}>
      {children}
    </div>
  );
}
