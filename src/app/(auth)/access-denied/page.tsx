import { ShieldXIcon } from "lucide-react";
import type { Metadata } from "next";

import { signOut } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

export const metadata: Metadata = { title: "Access denied" };

export default function AccessDeniedPage() {
  return (
    <Empty className="border bg-card">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <ShieldXIcon />
        </EmptyMedia>
        <EmptyTitle>This account can’t operate the workspace</EmptyTitle>
        <EmptyDescription>
          Your sign-in worked, but this email is not on the operator allowlist. Sign out and use
          the operator account.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <form action={signOut}>
          <Button type="submit" variant="outline" size="lg">
            Sign out
          </Button>
        </form>
      </EmptyContent>
    </Empty>
  );
}
