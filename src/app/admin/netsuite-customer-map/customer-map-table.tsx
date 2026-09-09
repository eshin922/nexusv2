"use client";

import { useRouter } from "next/navigation";
import {
  saveCustomerMapping,
  searchNetsuiteCustomersForMapping,
  type CustomerMappingRow,
} from "@/app/actions/netsuite-customer-map";
import { CustomerMapView } from "./customer-map-view";

/**
 * Wiring only.
 *
 * Every rule lives in `CustomerMapView`, which takes its services as props so
 * it can be mounted in a test with doubles. This wrapper exists to supply the
 * real ones — and to be the single place that imports the `"use server"`
 * module, which a mounted test cannot load.
 *
 * Deliberately branch-free: anything with a decision in it belongs on the
 * other side of this boundary, where it can be exercised.
 */
export function CustomerMapTable({ rows }: { rows: CustomerMappingRow[] }) {
  const router = useRouter();
  return (
    <CustomerMapView
      rows={rows}
      search={searchNetsuiteCustomersForMapping}
      save={saveCustomerMapping}
      refresh={() => router.refresh()}
    />
  );
}
