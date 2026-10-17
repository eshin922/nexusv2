# Sandbox invoice template candidate

- Existing preferred **DPS Invoice**: `CUSTTMPL_DPS_INVOICE`, sandbox template ID `502`; original source is `dps-invoice.sandbox-original.xml`.
- Separate **DPS Invoice — Nexus Quote Design (Sandbox)**: sandbox template ID `608`, script ID `CUSTTMPL_DPS_INVOICE_NEXUS_QUOTE`; saved source is `dps-invoice.quote-theme-candidate.xml`. It is **not preferred** and is not bound to the production invoice form.
- The candidate follows the approved PO/quote visual language: DPS logo, prominent INVOICE title, two-party address block, compact facts, four-column item table, restrained totals, and the existing invoice late-payment terms.
- It preserves the original invoice's HubSpot-line sorting, zero-quantity fallback, print-with-description choice, and excluded freight/OTC display rows. It does not print item-level specifications or formula references.
- NetSuite's sample-data PDF preview compiled and rendered as two pages with eight sample item rows. A sandbox invoice with real values, a form-binding audit, amount reconciliation, and disclosure review remain open before any production cutover.

These files document sandbox state. Copying them to a repository branch or merging that branch must not alter production NetSuite configuration or enable invoice printing from this candidate.
