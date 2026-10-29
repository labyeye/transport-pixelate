import { useAuth } from "@/contexts/AuthContext";
import { Menu } from "lucide-react";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { ProfileMenu } from "@/components/layout/ProfileMenu";
export function AppHeader({ title, onMenuOpen }) {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <header className="h-16 border-b-2 border-black bg-white flex items-center justify-between px-4 sm:px-6 sticky top-0 z-20 shrink-0">
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuOpen}
          className="lg:hidden w-9 h-9 border-2 border-black bg-white flex items-center justify-center hover:bg-[#024BAB]/10 transition-colors"
          aria-label="Open menu"
        >
          <Menu className="w-[18px] h-[18px] text-black" />
        </button>
        <h1 className="font-display font-bold text-lg sm:text-xl text-black">
          {title}
        </h1>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <NotificationBell />
        <ProfileMenu />
      </div>
    </header>
  );
}
