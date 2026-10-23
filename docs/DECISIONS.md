# Decisions and corrections to the takeoff sheet

Jonathan's rulings on fence rules where the EZ-Quote sheet (TAKEOFF_RULES.md) and the app disagreed,
or where the sheet was wrong. Newest first. TAKEOFF_RULES.md carries the same correction on its row.

## 2026-10-23: matching imported rows to customers on file (every import)

- **Only phone or email find a match:** the same phone (last 10 digits) or the same email (any capitals). A name alone never matches anyone.
- **Same name: attach.** The row goes on the customer on file. Nothing on that customer is overwritten; the import adds its notes, its stored row and its tag.
- **Phone or email match plus a different name: a new customer and a Possible match.** The row becomes a new customer (with its card by the import's own card rule, like any new customer), and its page shows a Possible match notice pointing at the customer on file, so the real ones are merged with one tap (Merge / Not the same person).
- **Several customers match:** the row goes to the single one with the same name. If none has the same name, or more than one does, the row is not imported and is listed for Jonathan.
- **Same name means:** both names cut into words of letters only (accents, capitals, punctuation and spacing ignored), and either all the letters are the same ("John StClair" = "John St. Clair"), or every word of one name, at least two words and each at least two letters, is a word of the other ("Elsa Ipus" = "Roger & Elsa Ipus", "Nonito Palencia Jr." = "Nonito Palencia"). A first name only, a nickname or an initial is a different name: "Ant G" is not "Anthony Gonzalez", "Jennifer D" is not "Jennifer", "Ted miiler" is not "Ted Miller".
- **Undo import** removes the new customers and their Possible matches with everything else the import made.
- **In the app:** apps/portal/src/server/lib/customerImport.ts (`sameName`, `decideMatch`), used by lib/mybudgetquoteImport.ts; pinned in apps/portal/tests/mybudgetquoteImport.db.test.ts.
- **Also decided for the MyBudgetQuote import (Oct 23):** lead sources Search Engine → website/google, Friend or Family → Referral, Facebook → Facebook, Other → Other, the rest (Other Social Media, Mail Ad, Banner Ad, Press Coverage, TV Ad, Home Show) kept as their own sources; the "Other" text word for word in the note; all Possible matches between two new customers with the same email and street kept; a customer on file who already has a card in the target column gets no second card.

## 2026-10-21 (evening): tan 6x8 is 15 pickets; 8 ft tall vinyl priced by the piece

- **Tan 6 ft tall, 8 ft wide:** 15 pickets a section, as White and Chai Gray. This reverses the Oct 20 ruling below (16, as on the sheet). Applies to TV-ND / TV-DS 6'x8' and to the 8 ft rail runs of TV-Auto DS.
- **8 ft tall vinyl, every color, ND and DS** (White, Tan, Chai Gray and any color added later in Settings > Price List > Vinyl Colors): priced by the piece, like job lot pricing: one price per section and one per post (corner, end and line), set for each 8 ft tall style in Settings > Price List > 8 ft tall vinyl (a color made with the form: its 8x6 / 8x8 section price and 8 ft post price, saved on its 8 ft tall fences, editable in either place). Until both prices are in, the style is not available for quoting (the same "Not available for quoting" as commercial).
- **The pull sheet still lists every part, at $0,** so the crew loads the right material. A section: 2 rails (top and bottom) and 1 mid rail of the panel's width, 4 ft pickets (22 at 6 ft wide, 30 at 8 ft wide), 4 U channels (4 ft), and on an 8 ft wide panel 2 rail inserts (`Vinyl, Rail Insert, 8'`, shared). The whole "V , W, Picket Section 8' x 6' / 8' x 8' Privacy" item is no longer used. A post keeps its kit (8 ft post, cap, donuts and pipe or concrete), covered by the post price.
- **Gates on 8 ft tall stay as they were:** priced from their parts (the whole 8 x 4 gate per leaf, hinges, latch, handles, gate caps, 2 bags of concrete per dig set walk gate), not covered by the section or post price; no blank post at a double gate.
- **New catalog items, $0, included in the section price** (made once per company at start-up for White, which has 8 ft tall fences; Jonathan may rename them): `*Vinyl, White, Picket, 4'`, `*Vinyl, White, U Channel, 4'`, `*Vinyl, White, Mid Rail, 6'`, `*Vinyl, White, Mid Rail, 8'`. A color made with the form makes its own (`*Vinyl, {Color}, Picket, 4'` and so on, and `*Vinyl, {Color}, Post, 5" x 5", 8' Privacy`). Tan has no 8 ft tall fence in Settings, so no Tan items were made.
- **Saved quotes** keep the prices they were priced with; sent and signed proposals are not changed.
- **In the app:** apps/web/src/materialCalculator.ts (TALL_VINYL_SECTION, the tan count), fenceCatalog.ts (tallJobLot, the hold), materialKits.ts (piece prices that cover a whole kit), vinylColorForm.ts, TallVinylPrices.tsx, tallVinylParts.ts; pinned in apps/portal/tests/tallVinyl.test.ts and vinylColorForm.test.ts.

## 2026-10-21: vinyl colors added with the form (Chai Gray)

- **Rail stiffener:** "technically universal to privacy vinyl for the 8ft rails regardless of color." An 8 ft rail's stiffener in a section kit is White's `Vinyl, Rail Insert, 8'`, shared; the form makes no color copy of it. Inside a section kit it is $0 (the section cost covers it).
- **Gate leaf:** can use the whole 6x8 section kit (15 kits for 14 sections plus one walk gate).
- **Gate caps:** use the post cap price.
- **Rivets:** "will probably use black, about 5X the cost of white rivets." The form has a Rivets choice (White, shared, or another color at its own price). Chai Gray's black rivet price is still to be given.
- **In the app:** apps/web/src/vinylColorForm.ts, pinned in apps/portal/tests/vinylColorForm.test.ts.

## 2026-10-21: Bell 4'x6' gate kit is one per gate leaf (correction to the sheet)

- **Sheet:** "Misc, Gate Kit, No Hardware" for `WV-ND Bell 4'x6'` / `WV-DS Bell 4'x6'` = `gateCount*2`
  (a double gate counts as 2 gates, so 2 kits per walk gate and 4 per double gate).
- **Jonathan:** "1 per walk gate, 2 per double. One kit builds one leaf." So the row is `gateCount`.
- **Also decided the same day:**
  - A Bell gate is built from a gate kit (hardware and uprights) plus one fence section, so each gate leaf also adds one section ("Misc, 6' Section" = `gateCount + totalSections`, as on the sheet).
  - Bell sections and labor are priced like a 6'x6' white vinyl privacy section until the real supplier cost is entered. The style is flagged for cost review.
- **In the app:** apps/web/src/materialCalculator.ts (Bell gate lines), pinned in apps/portal/tests/materialKits.test.ts.
- **Live:** the Oct 21 deploy 0a2ce01 briefly had the sheet's double count. No live quote used the Bell, so no live price was affected.

## 2026-10-20: tan vinyl 8 ft pickets stay 16 per section

- An earlier note in TAKEOFF_RULES changed tan 8 ft pickets to 15 (the white row has 15). Jonathan confirmed 16, as on the sheet and in the app.
- **Reversed on Oct 21, 2026:** 15 (see above).

## 2026-10-20 and 2026-10-21: other sheet rows applied as written

- White and tan dig set walk gates take 2 bags of concrete each, tan dig set 8 ft tall included. The sheet's "Misc, Concrete" DS row is read with blank posts counted once.
- Tan dig set gates take 2 uprights per walk gate and 4 per double, a 6 ft P-channel per leaf, and 2 latches per double gate.
- Tan walk gate H-beams stay 6 ft. The sheet lists 8 ft; Jonathan chose 6 ft.
- Gate handles, 2 per gate leaf, go on every white and tan privacy style with a parts list.
- Chain link hook ties: 9 / 10 / 11 per section at 4 / 5 / 6 ft. Commercial chain link keeps its own count for now.
- Tees: corner post on chain link, aluminum and wood; line post on vinyl (route the third side on site).
