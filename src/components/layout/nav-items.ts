import {
  ActivityIcon,
  GitCompareArrowsIcon,
  LayoutDashboardIcon,
  ReceiptTextIcon,
  SettingsIcon,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  title: string;
  href: "/overview" | "/reconciliation" | "/obligations" | "/activity" | "/settings";
  icon: LucideIcon;
};

export const primaryNav: NavItem[] = [
  { title: "Overview", href: "/overview", icon: LayoutDashboardIcon },
  { title: "Reconciliation", href: "/reconciliation", icon: GitCompareArrowsIcon },
  { title: "Obligations", href: "/obligations", icon: ReceiptTextIcon },
  { title: "Activity", href: "/activity", icon: ActivityIcon },
];

export const secondaryNav: NavItem[] = [{ title: "Settings", href: "/settings", icon: SettingsIcon }];

export function titleForPath(pathname: string): string {
  const match = [...primaryNav, ...secondaryNav].find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  return match?.title ?? "Ledgistry";
}
