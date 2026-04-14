/**
 * Seed EZ Budget services from the original fence pricing data.
 *
 * Run from apps/portal/:
 *   npx tsx scripts/seed-ez-budget.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const services = [
  // ── VINYL ──
  { name: 'Full Privacy', category: 'Vinyl', basePriceCents: 12500, unitLabel: 'per section', imageUrl: '/images/fences/vinyl-full-privacy.png', description: 'Solid tongue-and-groove panels for complete privacy.', metadata: { panelWidth: 8, heightPrices: { '4ft': 8500, '5ft': 10500, '6ft': 12500, '8ft': 16500 }, walkGateCents: 25000, doubleGateCents: 80000, laborHoursPerSection: 0.75, laborRate: 45, colors: ['White', 'Tan'] } },
  { name: 'Semi-Privacy', category: 'Vinyl', basePriceCents: 10500, unitLabel: 'per section', imageUrl: '/images/fences/vinyl-semi-privacy.png', description: 'Spaced boards allow airflow while providing good coverage.', metadata: { panelWidth: 8, heightPrices: { '4ft': 7000, '5ft': 8800, '6ft': 10500, '8ft': 14000 }, walkGateCents: 25000, doubleGateCents: 80000, colors: ['White', 'Tan'] } },
  { name: 'Lattice Top', category: 'Vinyl', basePriceCents: 13500, unitLabel: 'per section', imageUrl: '/images/fences/vinyl-lattice-top.png', description: 'Privacy panels with decorative lattice on top.', metadata: { panelWidth: 8, heightPrices: { '4ft': 9000, '5ft': 11000, '6ft': 13500, '8ft': 17500 }, walkGateCents: 25000, doubleGateCents: 80000, colors: ['White', 'Tan'] } },
  { name: 'Picket', category: 'Vinyl', basePriceCents: 8000, unitLabel: 'per section', imageUrl: '/images/fences/vinyl-picket.png', description: 'Classic American picket style for front yards.', metadata: { panelWidth: 8, heightPrices: { '4ft': 5500, '5ft': 6800, '6ft': 8000, '8ft': 11000 }, walkGateCents: 25000, doubleGateCents: 80000, colors: ['White'] } },
  { name: 'Closed Picket', category: 'Vinyl', basePriceCents: 8800, unitLabel: 'per section', imageUrl: '/images/fences/vinyl-closed-picket.png', description: 'Tightly spaced pickets for a more solid look.', metadata: { panelWidth: 8, heightPrices: { '4ft': 6000, '5ft': 7400, '6ft': 8800, '8ft': 11800 }, walkGateCents: 25000, doubleGateCents: 80000, colors: ['White'] } },
  { name: 'Spindle Top', category: 'Vinyl', basePriceCents: 14000, unitLabel: 'per section', imageUrl: '/images/fences/vinyl-spindle-top.png', description: 'Privacy panel with decorative spindle accents on top.', metadata: { panelWidth: 8, heightPrices: { '4ft': 9500, '5ft': 11500, '6ft': 14000, '8ft': 18000 }, walkGateCents: 25000, doubleGateCents: 80000, colors: ['White', 'Tan'] } },
  { name: 'Post & Rail', category: 'Vinyl', basePriceCents: 5500, unitLabel: 'per section', imageUrl: '/images/fences/vinyl-post-rail.png', description: 'Open ranch-style fence for property lines and farms.', metadata: { panelWidth: 8, heightPrices: { '4ft': 4000, '5ft': 4800, '6ft': 5500, '8ft': 7000 }, walkGateCents: 25000, doubleGateCents: 80000, colors: ['White', 'Tan'] } },

  // ── ALUMINUM ──
  { name: 'Emily', category: 'Aluminum', basePriceCents: 9500, unitLabel: 'per section', imageUrl: '/images/fences/aluminum-emily.png', description: 'Classic flat-top aluminum fence. Pool-safe.', metadata: { panelWidth: 6, heightPrices: { '4ft': 6500, '5ft': 7800, '6ft': 9500, '8ft': 13000 }, walkGateCents: 30000, doubleGateCents: 90000, colors: ['Black', 'Bronze', 'White'] } },
  { name: 'Ella Marie', category: 'Aluminum', basePriceCents: 10800, unitLabel: 'per section', imageUrl: '/images/fences/aluminum-ella-marie.png', description: 'Spear-top pickets with decorative finials.', metadata: { panelWidth: 6, heightPrices: { '4ft': 7500, '5ft': 9000, '6ft': 10800, '8ft': 14500 }, walkGateCents: 30000, doubleGateCents: 90000, colors: ['Black', 'Bronze'] } },
  { name: 'Bella Rose', category: 'Aluminum', basePriceCents: 11500, unitLabel: 'per section', imageUrl: '/images/fences/aluminum-bella-rose.png', description: 'Arched top rail with decorative curves.', metadata: { panelWidth: 6, heightPrices: { '4ft': 8000, '5ft': 9500, '6ft': 11500, '8ft': 15000 }, walkGateCents: 30000, doubleGateCents: 90000, colors: ['Black', 'Bronze', 'White'] } },
  { name: 'Madison', category: 'Aluminum', basePriceCents: 10200, unitLabel: 'per section', imageUrl: '/images/fences/aluminum-madison.png', description: 'Double-rail design with puppy picket option.', metadata: { panelWidth: 6, heightPrices: { '4ft': 7000, '5ft': 8500, '6ft': 10200, '8ft': 13800 }, walkGateCents: 30000, doubleGateCents: 90000, colors: ['Black', 'Bronze'] } },
  { name: 'Abigail', category: 'Aluminum', basePriceCents: 11200, unitLabel: 'per section', imageUrl: '/images/fences/aluminum-abigail.png', description: 'Staggered height pickets with alternating spear-top.', metadata: { panelWidth: 6, heightPrices: { '4ft': 7800, '5ft': 9200, '6ft': 11200, '8ft': 14800 }, walkGateCents: 30000, doubleGateCents: 90000, colors: ['Black', 'Bronze'] } },

  // ── CHAIN LINK ──
  { name: 'Standard Galvanized', category: 'Chain Link', basePriceCents: 6500, unitLabel: 'per section', imageUrl: '/images/fences/chain-link-galvanized.jpg', description: 'Classic galvanized chain link. Most affordable option.', metadata: { panelWidth: 10, heightPrices: { '4ft': 4500, '5ft': 5500, '6ft': 6500, '8ft': 8500 }, walkGateCents: 15000, doubleGateCents: 55000, colors: ['Galvanized'] } },
  { name: 'Black PVC-Coated', category: 'Chain Link', basePriceCents: 8000, unitLabel: 'per section', imageUrl: '/images/fences/chain-link-black.jpg', description: 'Black vinyl-coated for better appearance.', metadata: { panelWidth: 10, heightPrices: { '4ft': 5500, '5ft': 6800, '6ft': 8000, '8ft': 10500 }, walkGateCents: 17500, doubleGateCents: 60000, colors: ['Black'] } },

  // ── WOOD ──
  { name: 'Privacy (Board on Board)', category: 'Wood', basePriceCents: 9500, unitLabel: 'per section', imageUrl: '/images/fences/wood-privacy.jpg', description: 'Overlapping boards for complete privacy.', metadata: { panelWidth: 8, heightPrices: { '4ft': 6500, '5ft': 8000, '6ft': 9500, '8ft': 13000 }, walkGateCents: 20000, doubleGateCents: 70000, colors: ['Natural', 'Stained Cedar', 'Stained Walnut'] } },
  { name: 'Picket', category: 'Wood', basePriceCents: 7500, unitLabel: 'per section', imageUrl: '/images/fences/vinyl-picket.png', description: 'Traditional wood picket fence.', metadata: { panelWidth: 8, heightPrices: { '4ft': 5000, '5ft': 6200, '6ft': 7500, '8ft': 10000 }, walkGateCents: 20000, doubleGateCents: 70000, colors: ['Natural', 'White Painted'] } },
  { name: 'Shadowbox', category: 'Wood', basePriceCents: 8500, unitLabel: 'per section', imageUrl: '/images/fences/wood-privacy.jpg', description: 'Alternating boards on each side with airflow.', metadata: { panelWidth: 8, heightPrices: { '4ft': 5800, '5ft': 7200, '6ft': 8500, '8ft': 11500 }, walkGateCents: 20000, doubleGateCents: 70000, colors: ['Natural', 'Stained Cedar'] } },

  // ── ORNAMENTAL IRON ──
  { name: 'Flat Top', category: 'Ornamental Iron', basePriceCents: 14000, unitLabel: 'per section', imageUrl: '/images/fences/iron-flat-top.png', description: 'Clean horizontal top rail. Pool-safe.', metadata: { panelWidth: 6, heightPrices: { '4ft': 9500, '5ft': 11500, '6ft': 14000, '8ft': 18500 }, walkGateCents: 35000, doubleGateCents: 110000, colors: ['Black', 'Bronze'] } },
  { name: 'Spear Top', category: 'Ornamental Iron', basePriceCents: 15500, unitLabel: 'per section', imageUrl: '/images/fences/iron-spear-top.png', description: 'Traditional spear-point finials for elegance.', metadata: { panelWidth: 6, heightPrices: { '4ft': 10500, '5ft': 12500, '6ft': 15500, '8ft': 20500 }, walkGateCents: 35000, doubleGateCents: 110000, colors: ['Black', 'Bronze'] } },
  { name: 'Staggered Spear Top', category: 'Ornamental Iron', basePriceCents: 17500, unitLabel: 'per section', imageUrl: '/images/fences/iron-staggered-spear.png', description: 'Alternating height spear-top for estate look.', metadata: { panelWidth: 6, heightPrices: { '4ft': 12000, '5ft': 14500, '6ft': 17500, '8ft': 23000 }, walkGateCents: 35000, doubleGateCents: 110000, colors: ['Black'] } },
]

async function seed() {
  console.log('Seeding EZ Budget services...\n')

  // Clear existing
  await prisma.ezBudgetLineItem.deleteMany()
  await prisma.ezBudgetService.deleteMany()
  console.log('  Cleared existing services\n')

  for (let i = 0; i < services.length; i++) {
    const s = services[i]
    await prisma.ezBudgetService.create({
      data: {
        name: s.name,
        category: s.category,
        basePriceCents: s.basePriceCents,
        unitLabel: s.unitLabel,
        imageUrl: s.imageUrl,
        description: s.description,
        active: true,
        sortOrder: i,
        metadata: s.metadata,
      },
    })
    console.log(`  + ${s.category} — ${s.name} (${(s.basePriceCents / 100).toFixed(2)}/section)`)
  }

  // Seed default settings
  await prisma.ezBudgetSettings.upsert({
    where: { key: 'widgetConfig' },
    update: { value: { companyName: 'EZ Budget', primaryColor: '#16a34a', taxRate: 0, quoteExpiryDays: 30 } },
    create: { key: 'widgetConfig', value: { companyName: 'EZ Budget', primaryColor: '#16a34a', taxRate: 0, quoteExpiryDays: 30 }, description: 'Widget branding and config' },
  })

  await prisma.ezBudgetSettings.upsert({
    where: { key: 'quoteRange' },
    update: { value: { lowPercent: -5, highPercent: 15, label: 'Estimated Budget Range' } },
    create: { key: 'quoteRange', value: { lowPercent: -5, highPercent: 15, label: 'Estimated Budget Range' }, description: 'Customer-facing price range' },
  })

  await prisma.ezBudgetSettings.upsert({
    where: { key: 'notifications' },
    update: { value: { emailEnabled: false, notificationEmail: '' } },
    create: { key: 'notifications', value: { emailEnabled: false, notificationEmail: '' }, description: 'Quote notification settings' },
  })

  console.log('\n  + Settings seeded')
  console.log(`\nDone! ${services.length} services created.`)
  await prisma.$disconnect()
}

seed().catch(e => { console.error(e); process.exit(1) })
