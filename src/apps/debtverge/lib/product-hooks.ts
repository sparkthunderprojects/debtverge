import { useEffect, useState } from "react";
import { supabase } from "@/core/supabase";
import type { WorkspaceViewMode } from "@/core/types";

export type ProductKey = "dmp_advisor" | "insolvency_advisor" | "voip" | "compliance";
export interface Product { product_key: ProductKey; name: string; description: string }

/** Products this firm is licensed for (enforced in the database too: unlicensed firms cannot read case data). */
export function useMyProducts() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    supabase.rpc("my_products").then(({ data }) => {
      if (!alive) return;
      setProducts((data ?? []) as Product[]);
      setLoading(false);
    });
    return () => { alive = false; };
  }, []);
  return { products, loading };
}

export const PRODUCT_NAME: Record<ProductKey, string> = { dmp_advisor: "DMP Advisor", insolvency_advisor: "Insolvency Advisor", voip: "Phone", compliance: "Call compliance" };

/** Workspace views a firm may use, based on its licences. */
export function allowedViewModes(products: Product[]): WorkspaceViewMode[] {
  const keys = new Set(products.map((p) => p.product_key));
  const modes: WorkspaceViewMode[] = [];
  if (keys.has("dmp_advisor")) modes.push("dmp");
  if (keys.has("insolvency_advisor")) modes.push("iva");
  if (modes.length > 1) modes.push("all");
  return modes;
}
