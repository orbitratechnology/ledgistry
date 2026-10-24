import { Suspense } from "react";

import { AppSidebar } from "@/components/layout/app-sidebar";
import { ConnectionBadge, ConnectionBadgeSkeleton } from "@/components/layout/connection-badge";
import { NavUserSkeleton } from "@/components/layout/nav-user";
import { SidebarUser } from "@/components/layout/sidebar-user";
import { SiteHeader } from "@/components/layout/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

/**
 * Static app shell (prerendered); everything that reads the session or Airwallex streams in
 * behind its own Suspense boundary.
 */
export default function WorkspaceLayout({ children }: LayoutProps<"/">) {
  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 64)",
          "--header-height": "calc(var(--spacing) * 14)",
        } as React.CSSProperties
      }
    >
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:shadow-md focus:ring-3 focus:ring-ring/50"
      >
        Skip to main content
      </a>
      <AppSidebar
        variant="inset"
        userSlot={
          <Suspense fallback={<NavUserSkeleton />}>
            <SidebarUser />
          </Suspense>
        }
      />
      <SidebarInset className="min-w-0">
        <SiteHeader
          connectionSlot={
            <Suspense fallback={<ConnectionBadgeSkeleton />}>
              <ConnectionBadge />
            </Suspense>
          }
        />
        <div id="main-content" tabIndex={-1} className="@container/main flex min-w-0 flex-1 flex-col outline-none">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
