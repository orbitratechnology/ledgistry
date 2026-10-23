"use client";

import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function ReconTabs({
  review,
  deposits,
  receipts,
  counts,
  defaultTab,
}: {
  review: React.ReactNode;
  deposits: React.ReactNode;
  receipts: React.ReactNode;
  counts: { review: number; deposits: number; receipts: number };
  defaultTab: "review" | "deposits" | "receipts";
}) {
  return (
    <Tabs defaultValue={defaultTab} className="gap-4">
      <div className="max-w-full overflow-x-auto">
        <TabsList className="h-10 md:h-8">
          <TabsTrigger value="review" className="px-3">
            Review
            {counts.review > 0 ? <Badge variant="default">{counts.review}</Badge> : null}
          </TabsTrigger>
          <TabsTrigger value="deposits" className="px-3">
            Deposits <span className="text-muted-foreground tabular-nums">{counts.deposits}</span>
          </TabsTrigger>
          <TabsTrigger value="receipts" className="px-3">
            Expected receipts <span className="text-muted-foreground tabular-nums">{counts.receipts}</span>
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="review">{review}</TabsContent>
      <TabsContent value="deposits">{deposits}</TabsContent>
      <TabsContent value="receipts">{receipts}</TabsContent>
    </Tabs>
  );
}
