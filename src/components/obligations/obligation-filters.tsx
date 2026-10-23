"use client";

import { SearchIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const VIEWS = [
  { value: "open", label: "Open" },
  { value: "all", label: "All" },
  { value: "archived", label: "Archived" },
] as const;

export function ObligationFilters({ currencies }: { currencies: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function update(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center" role="search" aria-label="Filter obligations">
      <ToggleGroup
        variant="outline"
        value={[params.get("view") ?? "open"]}
        onValueChange={(value) => update("view", value[0] === "open" ? null : (value[0] ?? null))}
        aria-label="Which obligations to show"
      >
        {VIEWS.map((view) => (
          <ToggleGroupItem key={view.value} value={view.value} className="h-10 px-3 md:h-8">
            {view.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <div className="flex flex-1 gap-3">
        <NativeSelect
          aria-label="Currency"
          value={params.get("currency") ?? ""}
          onChange={(event) => update("currency", event.target.value || null)}
          className="*:h-10 md:*:h-8"
        >
          <NativeSelectOption value="">All currencies</NativeSelectOption>
          {currencies.map((code) => (
            <NativeSelectOption key={code} value={code}>
              {code}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <InputGroup className="h-10 flex-1 md:h-8 md:max-w-xs">
          <InputGroupInput
            type="search"
            aria-label="Search payee, description or invoice"
            placeholder="Search payee or invoice"
            defaultValue={params.get("q") ?? ""}
            onChange={(event) => update("q", event.target.value.trim() || null)}
          />
          <InputGroupAddon>{pending ? <Spinner /> : <SearchIcon />}</InputGroupAddon>
        </InputGroup>
      </div>
    </div>
  );
}
