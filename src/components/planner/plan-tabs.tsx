"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/** One tab per planned currency; panels are rendered on the server. */
export function PlanTabs({
  panels,
  defaultCurrency,
}: {
  panels: { currency: string; attention: boolean; content: React.ReactNode }[];
  defaultCurrency: string;
}) {
  return (
    <Tabs defaultValue={defaultCurrency} className="gap-4">
      <div className="max-w-full overflow-x-auto">
        <TabsList className="h-10 md:h-8" aria-label="Plan currency">
          {panels.map((panel) => (
            <TabsTrigger key={panel.currency} value={panel.currency} className="px-3">
              {panel.currency}
              {panel.attention ? <span className="size-1.5 rounded-full bg-warning" aria-label="needs attention" /> : null}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {panels.map((panel) => (
        <TabsContent key={panel.currency} value={panel.currency}>
          {panel.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
