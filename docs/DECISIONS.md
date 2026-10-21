# Decisions and corrections to the takeoff sheet

Jonathan's rulings on fence rules where the EZ-Quote sheet (TAKEOFF_RULES.md) and the app disagreed,
or where the sheet was wrong. Newest first. TAKEOFF_RULES.md carries the same correction on its row.

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

## 2026-10-20 and 2026-10-21: other sheet rows applied as written

- White and tan dig set walk gates take 2 bags of concrete each, tan dig set 8 ft tall included. The sheet's "Misc, Concrete" DS row is read with blank posts counted once.
- Tan dig set gates take 2 uprights per walk gate and 4 per double, a 6 ft P-channel per leaf, and 2 latches per double gate.
- Tan walk gate H-beams stay 6 ft. The sheet lists 8 ft; Jonathan chose 6 ft.
- Gate handles, 2 per gate leaf, go on every white and tan privacy style with a parts list.
- Chain link hook ties: 9 / 10 / 11 per section at 4 / 5 / 6 ft. Commercial chain link keeps its own count for now.
- Tees: corner post on chain link, aluminum and wood; line post on vinyl (route the third side on site).
