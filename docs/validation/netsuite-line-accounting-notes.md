# SKU accounting notes on Sales Order lines

Nexus stores an internal note on each quote-specific product SKU. Sending a
quote freezes it with that product line. The Order Packet shows the frozen note
to Accounting; the customer quote and PDF do not show it.

The NetSuite destination is a dedicated **Long Text** Sales Order item-column
field, `custcol_nx_accounting_note`, labelled **Nexus Accounting Instruction**.
Apply it to Sales Orders only. It must be editable by the Nexus Integration
role and visible to Accounting, but excluded from customer-facing transaction
forms and Advanced PDF templates. Do not substitute the standard Description
field: that can flow to invoices and other customer documents.

The transfer uses each frozen product line and the posted Sales Order's
`lineUniqueKey` to locate the correct row, including expanded Item Group
members. It patches only the custom note field, then reads the order back to
verify the note, line identities, quantities, rates, amounts, and total.
Ambiguous matches fail without writing. A retry skips already correct lines.

`NETSUITE_LINE_ACCOUNTING_NOTE_EXPORT=enabled` is required for writes. It
defaults off in every environment until the field and role permissions are
verified in sandbox. Production NetSuite remains out of scope until the
separate cutover signal. A transfer failure does not roll back a commercially
correct Sales Order; Accounting can still read the frozen note in the Order
Packet.
