-- Customer wording, Nov 7 2026 (Jonathan's typed OK): no "best price", no "faster install".
-- Wording only: the vinyl Good text in Settings, and the same words saved in quotes not signed yet (Sent, Draft).
-- Signed contracts and Lost quotes are left as they were. No price, no other field changes.
\set ON_ERROR_STOP 1
BEGIN;
\set G_OLD '''Posts set in concrete. Solid fence at the best price.'''
\set G_NEW '''Posts set in concrete. A solid fence at our lowest price.'''
\set N1_OLD '''No dig: steel pipe driven deep, no concrete, faster install.'''
\set N1_NEW '''No dig: steel reinforced posts with no concrete to crack or heave. The stronger option, backed by our Lifetime Craftsmanship Warranty.'''
\set N_OLD '''Steel pipe driven deep, no concrete, faster install.'''
\set N_NEW '''Steel reinforced posts with no concrete to crack or heave. The stronger option, backed by our Lifetime Craftsmanship Warranty.'''

SELECT 'tier sets to change: ' || count(*) FROM "ProposalTierSet" WHERE tiers::text LIKE '%' || :G_OLD || '%';
UPDATE "ProposalTierSet" SET tiers = replace(tiers::text, :G_OLD, :G_NEW)::jsonb, version = version + 1, "updatedAt" = now()
 WHERE category = 'Vinyl' AND tiers::text LIKE '%' || :G_OLD || '%';

CREATE TEMP TABLE pick AS SELECT id, status FROM "SavedQuote"
 WHERE "deletedAt" IS NULL AND "acceptedAt" IS NULL AND status IN ('SENT', 'DRAFT')
   AND (coalesce(proposal::text, '') || coalesce(layout::text, '')) ~ 'best price\.|faster install\.';
SELECT 'quotes to change: ' || status || ' ' || count(*) FROM pick GROUP BY status;
UPDATE "SavedQuote" q SET
  proposal = replace(replace(replace(q.proposal::text, :N1_OLD, :N1_NEW), :N_OLD, :N_NEW), :G_OLD, :G_NEW)::jsonb,
  layout = CASE WHEN q.layout IS NULL THEN NULL ELSE replace(replace(replace(q.layout::text, :N1_OLD, :N1_NEW), :N_OLD, :N_NEW), :G_OLD, :G_NEW)::jsonb END
 FROM pick WHERE q.id = pick.id;

SELECT 'left in those quotes: ' || count(*) FROM "SavedQuote" q JOIN pick USING (id)
 WHERE (coalesce(q.proposal::text, '') || coalesce(q.layout::text, '')) ~ 'best price\.|faster install\.';
SELECT 'vinyl Good now: ' || (t->>'text') FROM "ProposalTierSet", jsonb_array_elements(tiers) t WHERE category = 'Vinyl' AND t->>'key' = 'good';
COMMIT;
