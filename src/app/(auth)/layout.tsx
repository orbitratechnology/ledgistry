import { Logo } from "@/components/brand/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted px-4 py-10">
      <Logo />
      <main className="flex w-full max-w-sm flex-col gap-4">{children}</main>
      <p className="max-w-sm text-center text-xs text-muted-foreground">
        Sandbox prototype connected to Airwallex Sandbox. No real money moves. Ledgistry is not an
        Airwallex product.
      </p>
    </div>
  );
}
