import { useLocation, Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { getNavGroups } from "@/config/navigation";
import { BrandMark } from "@/components/common/BrandMark";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, LogOut, X } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

// Every page mounts its own AppLayout, so the sidebar remounts on navigation; keep scroll here.
let navScrollTop = 0;

interface AppSidebarProps {
  mobileOpen: boolean;
  onClose: () => void;
}

export function AppSidebar({ mobileOpen, onClose }: AppSidebarProps) {
  const { user, logout, can } = useAuth();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const navRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    if (navRef.current) navRef.current.scrollTop = navScrollTop;
  }, [user]);

  if (!user) return null;

  const groups = getNavGroups(can);

  return (
    <>
      <aside
        className={cn(
          "h-screen bg-white border-r-2 border-black flex flex-col transition-all duration-300 ease-out z-50 shrink-0",
          "fixed inset-y-0 left-0 lg:sticky lg:top-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
          collapsed ? "lg:w-16" : "w-62",
        )}
        style={{ width: collapsed ? undefined : "15.5rem" }}
      >
        <div
          className={cn(
            "h-16 flex items-center border-b-2 border-black shrink-0",
            collapsed ? "lg:justify-center lg:px-2 px-4 gap-3" : "px-4 gap-3",
          )}
        >
          <BrandMark collapsed={collapsed} />
          <button
            onClick={onClose}
            className="ml-auto lg:hidden p-1 hover:bg-[#024BAB]/10 border border-transparent hover:border-black transition-colors"
          >
            <X className="w-4 h-4 text-black" />
          </button>
        </div>

        <nav
          ref={navRef}
          onScroll={(e) => (navScrollTop = e.currentTarget.scrollTop)}
          className="flex-1 py-3 px-2 overflow-y-auto space-y-4">
          {groups.map((group) => (
            <div key={group.label}>
              {!collapsed && (
                <p className="px-3 mb-1 text-[10px] font-bold uppercase tracking-widest text-gray-400 select-none">
                  {group.label}
                </p>
              )}
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const active = location.pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      to={item.href}
                      title={collapsed ? item.title : undefined}
                      onClick={onClose}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2.5 text-sm font-semibold transition-all duration-100 border-2",
                        active
                          ? "bg-[#024BAB] border-black text-white border-2"
                          : "border-transparent text-black hover:bg-[#024BAB]/10 hover:border-black",
                        collapsed && "lg:justify-center lg:px-0",
                      )}
                    >
                      <item.icon className="w-[18px] h-[18px] shrink-0" />
                      <span className={cn(collapsed && "lg:hidden")}>
                        {item.title}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div
          className={cn(
            "border-t-2 border-black px-3 py-3 shrink-0",
            collapsed && "lg:hidden",
          )}
        >
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 border-2 border-black shrink-0 overflow-hidden bg-[#024BAB] flex items-center justify-center text-xs font-bold text-white">
              {user.name?.[0]?.toUpperCase() ?? "U"}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold text-black truncate">
                {user.name}
              </p>
              <p className="text-[10px] text-muted-foreground truncate capitalize">
                {user.role?.replace(/_/g, " ")}
              </p>
            </div>
          </div>
          <button
            onClick={logout}
            className="flex items-center gap-2 text-xs font-semibold text-black hover:text-red-600 transition-colors w-full py-1"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign out
          </button>
        </div>

        <button
          onClick={() => setCollapsed(!collapsed)}
          className="hidden lg:flex absolute -right-4 top-20 w-7 h-7 bg-[#024BAB] border-2 border-black items-center justify-center hover:bg-[#024BAB]/80 transition-colors"
        >
          {collapsed ? (
            <ChevronRight className="w-3.5 h-3.5 text-white" />
          ) : (
            <ChevronLeft className="w-3.5 h-3.5 text-white" />
          )}
        </button>
      </aside>
    </>
  );
}
