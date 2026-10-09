import { useState } from "react";
import { AppSidebar } from "./AppSidebar";
import { AppHeader } from "./AppHeader";
import { Toaster } from "@/components/ui/Toaster";

interface AppLayoutProps {
  title: string;
  children: React.ReactNode;
}

export function AppLayout({ title, children }: AppLayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen flex w-full bg-background">
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <AppSidebar
        mobileOpen={mobileOpen}
        onClose={() => setMobileOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <AppHeader title={title} onMenuOpen={() => setMobileOpen(true)} />
        <main className="flex-1 p-4 sm:p-6 overflow-auto">{children}</main>
      </div>
      <Toaster />
    </div>
  );
}
