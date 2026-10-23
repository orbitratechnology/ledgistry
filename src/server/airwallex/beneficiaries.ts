import "server-only";

import { z } from "zod";

import type { AirwallexClient } from "./client";

const beneficiarySchema = z
  .object({
    id: z.string().min(1),
    nickname: z.string().nullish(),
    transfer_methods: z.array(z.string()).nullish(),
    beneficiary: z
      .object({
        entity_type: z.string().nullish(),
        company_name: z.string().nullish(),
        first_name: z.string().nullish(),
        last_name: z.string().nullish(),
        bank_details: z
          .object({
            account_name: z.string().nullish(),
            account_currency: z.string().nullish(),
            bank_country_code: z.string().nullish(),
          })
          .loose()
          .nullish(),
      })
      .loose()
      .nullish(),
  })
  .loose();

const beneficiariesPageSchema = z.object({
  items: z.array(beneficiarySchema),
  has_more: z.boolean().nullish(),
});

export type BeneficiarySummary = {
  id: string;
  label: string;
  currency: string | null;
  country: string | null;
  transferMethods: string[];
};

/**
 * Payee options for obligations. Only display fields are returned — account numbers,
 * routing codes and personal identifiers stay at Airwallex.
 */
export async function listBeneficiaries(client: AirwallexClient): Promise<BeneficiarySummary[]> {
  const { data } = await client.request("/api/v1/beneficiaries", {
    query: { page_num: 0, page_size: 100 },
    schema: beneficiariesPageSchema,
  });
  return data.items
    .map((item) => {
      const details = item.beneficiary?.bank_details;
      const personName = [item.beneficiary?.first_name, item.beneficiary?.last_name]
        .filter(Boolean)
        .join(" ");
      const name =
        details?.account_name || item.beneficiary?.company_name || personName || item.nickname || item.id;
      return {
        id: item.id,
        label: item.nickname ? `${name} (${item.nickname})` : name,
        currency: details?.account_currency ?? null,
        country: details?.bank_country_code ?? null,
        transferMethods: item.transfer_methods ?? [],
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}
