"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useCallback, useState } from "react";
import { ShellSidebar } from "@/components/shell/shell-sidebar";
import { ShellTopbar } from "@/components/shell/shell-topbar";

type AppShellProps = {
  children: ReactNode;
  topbarRight: ReactNode;
  isLoggedIn: boolean;
};

export function AppShell({ children, topbarRight, isLoggedIn }: AppShellProps) {
  const pathname = usePathname();
  const isWatchRoute = pathname.startsWith("/watch/");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const close = useCallback(() => setSidebarOpen(false), []);
  const open = useCallback(() => setSidebarOpen(true), []);

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-[hsl(var(--background))] text-[hsl(var(--foreground))]">
      <ShellSidebar
        open={sidebarOpen}
        onClose={close}
        isLoggedIn={isLoggedIn}
      />
      <div className="flex min-w-0 flex-1 flex-col max-[900px]:pl-0">
        <ShellTopbar
          onOpenMenu={open}
          onLogoClick={close}
          topbarRight={topbarRight}
        />
        <div className="ot-app-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          {children}
        </div>
      </div>
      {sidebarOpen ? (
        <button
          type="button"
          aria-label="Close menu"
          className={
            isWatchRoute
              ? "fixed inset-0 z-40 block animate-[ot-fade-in_0.2s_ease] bg-black/60 backdrop-blur-sm"
              : "fixed inset-0 z-40 hidden animate-[ot-fade-in_0.2s_ease] bg-black/60 backdrop-blur-sm max-[900px]:block"
          }
          onClick={close}
        />
      ) : null}
    </div>
  );
}
