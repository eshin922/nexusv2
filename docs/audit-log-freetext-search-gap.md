
---

## Related banked cleanup — `NEXT_PUBLIC_` prefix on a server-only var

`NEXT_PUBLIC_APP_BASE_URL` is read only in server code
(`mark-complete.ts:1120`) to build the Order Packet URL. The `NEXT_PUBLIC_`
prefix means it is inlined at BUILD time, so changing it later needs a rebuild,
and it implies a client exposure that does not exist.

A plain `APP_BASE_URL` read at runtime would be the honest shape. **Deliberately
NOT renamed during the training window** — the variable is being set now, and
renaming it mid-window would invalidate the value just configured. Banked for
the cleanup window.
