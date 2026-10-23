"use client";

import { FlaskConicalIcon } from "lucide-react";
import { usePathname } from "next/navigation";

import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { titleForPath } from "./nav-items";

export function SiteHeader({ connectionSlot }: { connectionSlot: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-10 flex h-(--header-height) shrink-0 items-center gap-2 border-b bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/80 md:rounded-t-xl">
      <div className="flex w-full min-w-0 items-center gap-1 px-3 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1 size-10 md:size-7" aria-label="Toggle navigation" />
        <Separator orientation="vertical" className="mx-2 h-4 data-vertical:self-auto" />
        <h1 className="truncate text-base font-medium">{titleForPath(pathname)}</h1>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Badge variant="outline" className="hidden sm:inline-flex">
            <FlaskConicalIcon data-icon="inline-start" />
            Sandbox
          </Badge>
          {connectionSlot}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
