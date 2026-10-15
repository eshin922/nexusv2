# Quote page presence

The quote layout shows a small top notice when another enrolled Nexus user is active on the **same quote page**. Setup, Costs, Pricing, Quote, and the other quote routes each have separate presence scopes. Multiple tabs from one user produce one name; a user's own tabs do not appear in the notice.

`0152_quote_page_presence.sql` adds an ephemeral lease table. Only authenticated server actions read or write it. The browser never subscribes to that table or receives its rows. Leases are renewed every 10 seconds while the tab is visible and has had activity within two minutes. They expire after 35 seconds if a tab or connection disappears. Leaving a page also removes the lease best-effort. A Realtime broadcast carries only a generic “changed” hint, then each client fetches names from the authenticated action; the polling interval remains the fallback.

Rollout: apply migrations 0150–0152 in order before deploying the branch. Without 0152 the presence action fails harmlessly and no notice is shown, but presence is unavailable. Validate with two enrolled accounts on the same quote and page: the second account appears after joining, different quote sections stay separate, and hiding or closing a tab clears its notice. No production database migration or deployment was performed in this worktree.
