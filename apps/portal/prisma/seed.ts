import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('Seeding database...')

  // ── Create CRM Account ──
  const account = await prisma.crmAccount.upsert({
    where: { externalCrmId: 'gdf-001' },
    update: {},
    create: {
      externalCrmId: 'gdf-001',
      name: 'Getter Done Fence Pro',
      status: 'active',
      assignedRepName: 'Jonathan Bohdal',
      assignedRepEmail: 'jonathan@gdfencepro.com',
    },
  })
  console.log(`  Account: ${account.name} (${account.id})`)

  // ── Create Demo Customer ──
  const passwordHash = await bcrypt.hash('demo1234', 12)
  const customer = await prisma.customer.upsert({
    where: { email: 'demo@customer.com' },
    update: {},
    create: {
      email: 'demo@customer.com',
      passwordHash,
      firstName: 'Demo',
      lastName: 'Customer',
      phone: '352-555-0100',
      role: 'customer',
      accountId: account.id,
    },
  })
  console.log(`  Customer: ${customer.email} (password: demo1234)`)

  // ── Create Admin User ──
  const adminHash = await bcrypt.hash('admin1234', 12)
  const admin = await prisma.customer.upsert({
    where: { email: 'admin@gdfencepro.com' },
    update: {},
    create: {
      email: 'admin@gdfencepro.com',
      passwordHash: adminHash,
      firstName: 'Admin',
      lastName: 'User',
      role: 'admin',
      accountId: account.id,
    },
  })
  console.log(`  Admin: ${admin.email} (password: admin1234)`)

  // ── Create Sample Tickets ──
  const ticket1 = await prisma.ticket.create({
    data: {
      accountId: account.id,
      title: 'Gate latch not closing properly',
      description: 'The walk gate on the north side of the property does not latch fully. It was installed last month.',
      status: 'open',
      priority: 'medium',
    },
  })

  await prisma.ticketComment.createMany({
    data: [
      { ticketId: ticket1.id, authorName: 'Demo Customer', body: 'This started happening after the last heavy rain.', isInternal: false },
      { ticketId: ticket1.id, authorName: 'Jonathan B.', body: 'Thanks for letting us know. We\'ll send someone out this week.', isInternal: false },
      { ticketId: ticket1.id, authorName: 'Jonathan B.', body: 'Internal: Check if the post shifted. May need concrete patch.', isInternal: true },
    ],
  })

  await prisma.ticket.create({
    data: {
      accountId: account.id,
      title: 'Request for warranty information',
      description: 'I would like a copy of our fence warranty documentation.',
      status: 'resolved',
      priority: 'low',
    },
  })

  console.log('  Tickets: 2 created')

  // ── Create Sample Invoices ──
  await prisma.invoice.createMany({
    data: [
      {
        accountId: account.id,
        invoiceNumber: 'INV-2026-001',
        amountCents: 485000,
        dueDate: new Date('2026-03-15'),
        paidAt: new Date('2026-03-12'),
        status: 'paid',
      },
      {
        accountId: account.id,
        invoiceNumber: 'INV-2026-002',
        amountCents: 125000,
        dueDate: new Date('2026-04-30'),
        status: 'pending',
      },
      {
        accountId: account.id,
        invoiceNumber: 'INV-2026-003',
        amountCents: 275000,
        dueDate: new Date('2026-03-01'),
        status: 'overdue',
      },
    ],
  })
  console.log('  Invoices: 3 created')

  // ── Create Sample Contracts ──
  await prisma.contract.createMany({
    data: [
      {
        accountId: account.id,
        name: 'Vinyl Privacy Fence Installation',
        description: '120 ft WV-ND 6x6 privacy fence with 2 walk gates',
        startDate: new Date('2026-03-01'),
        endDate: new Date('2026-04-15'),
        status: 'active',
      },
      {
        accountId: account.id,
        name: 'Annual Fence Maintenance',
        description: 'Yearly inspection and maintenance of all installed fencing',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        status: 'active',
      },
    ],
  })
  console.log('  Contracts: 2 created')

  // ── Seed Pricing Rules (for Botpress chatbot) ──
  const pricingRules = [
    { fenceType: 'vinyl', displayName: 'Vinyl Privacy Fence', minPerFoot: 2500, maxPerFoot: 4500, description: '6ft privacy vinyl fence with post, rails, and pickets', sortOrder: 1 },
    { fenceType: 'aluminum', displayName: 'Aluminum Fence', minPerFoot: 2800, maxPerFoot: 5000, description: 'Ornamental aluminum fencing, 4-6ft heights', sortOrder: 2 },
    { fenceType: 'wood', displayName: 'Wood Fence', minPerFoot: 1800, maxPerFoot: 3500, description: 'Pressure-treated wood privacy or semi-privacy fence', sortOrder: 3 },
    { fenceType: 'chain_link', displayName: 'Chain Link Fence', minPerFoot: 1000, maxPerFoot: 2200, description: 'Galvanized or vinyl-coated chain link, 4-6ft', sortOrder: 4 },
    { fenceType: 'ornamental_iron', displayName: 'Ornamental Iron Fence', minPerFoot: 3500, maxPerFoot: 7000, description: 'Wrought iron style ornamental fencing', sortOrder: 5 },
    { fenceType: 'composite', displayName: 'Composite Fence', minPerFoot: 3000, maxPerFoot: 5500, description: 'Wood-plastic composite fencing', sortOrder: 6 },
    { fenceType: 'cedar', displayName: 'Cedar Fence', minPerFoot: 2200, maxPerFoot: 4000, description: 'Natural cedar privacy fence', sortOrder: 7 },
  ]

  for (const rule of pricingRules) {
    await prisma.pricingRule.upsert({
      where: { fenceType: rule.fenceType },
      update: { displayName: rule.displayName, minPerFoot: rule.minPerFoot, maxPerFoot: rule.maxPerFoot, description: rule.description, sortOrder: rule.sortOrder },
      create: rule,
    })
  }
  console.log(`  Pricing rules: ${pricingRules.length} seeded`)

  // ── Seed Default Automation: Signed Contract → Create Job ──
  await prisma.automation.upsert({
    where: { id: 'default-signed-contract' },
    update: {},
    create: {
      id: 'default-signed-contract',
      name: 'Signed Contract → Create Job & Notify',
      description: 'When a deal moves to Signed Contract, create a job, set it to Awaiting Locates, notify the rep, and log an activity note.',
      triggerType: 'sales_stage_change',
      triggerConfig: { toStage: 'Signed Contract' },
      actions: [
        {
          type: 'move_ops_stage',
          targetStage: 'staging',
        },
        {
          type: 'send_notification',
          notifyTo: 'rep',
          notifyTitle: 'New Job: {{customer_name}}',
          notifyBody: 'Contract signed for {{job_address}}. Job created and set to Awaiting Locates.',
        },
        {
          type: 'post_activity_note',
          noteText: 'Job created from signed contract — awaiting locates. Customer: {{customer_name}}, Address: {{job_address}}',
        },
        {
          type: 'create_task',
          taskTitle: 'Call locates for {{customer_name}}',
          taskDescription: 'New signed contract at {{job_address}}. Call 811 for utility locates.',
          taskAssignTo: 'role:ops_manager',
          taskDueDaysOffset: 1,
          taskPriority: 'high',
        },
      ],
      isActive: true,
      createdBy: 'system',
    },
  })
  console.log('  Default automation seeded: Signed Contract → Create Job')

  // ── Suggested Rain Day Automations (inactive examples) ──
  await prisma.automation.upsert({
    where: { id: 'rain-day-notify' },
    update: {},
    create: {
      id: 'rain-day-notify',
      name: 'Rain Day → Notify Customer & Crew',
      description: 'When a job is flagged as rain day, send reschedule email to customer, notify crew, and post activity note.',
      triggerType: 'rain_day_flagged',
      triggerConfig: {},
      actions: [
        { type: 'send_email', emailTo: 'customer', emailSubject: 'Schedule Update — {{company_name}}', emailBody: 'Hi {{customer_name}}, due to weather conditions your fence installation originally scheduled for the affected date has been rescheduled. We will confirm your new date shortly. Thank you for your patience! — {{company_name}}' },
        { type: 'send_notification', notifyTo: 'rep', notifyTitle: 'Rain Day: {{customer_name}}', notifyBody: 'Job at {{job_address}} has been flagged as a rain day and needs rescheduling.' },
        { type: 'post_activity_note', noteText: 'Job flagged as rain day. Customer and crew notified.' },
      ],
      isActive: false,
      createdBy: 'system',
    },
  })

  await prisma.automation.upsert({
    where: { id: 'rain-day-reminder' },
    update: {},
    create: {
      id: 'rain-day-reminder',
      name: 'Rain Day — No Reschedule Reminder',
      description: 'If a rain day job has no reschedule date set, remind the rep after 1 day.',
      triggerType: 'rain_day_flagged',
      triggerConfig: {},
      actions: [
        { type: 'schedule_reminder', reminderDaysOffset: 1, reminderMessage: 'Rain day job for {{customer_name}} at {{job_address}} still needs a reschedule date. Please update the schedule.', reminderTo: 'rep' },
      ],
      isActive: false,
      createdBy: 'system',
    },
  })

  console.log('  Rain day automations seeded (inactive examples)')

  console.log('\nSeed complete!')
  console.log('─'.repeat(40))
  console.log('Demo login:  demo@customer.com / demo1234')
  console.log('Admin login: admin@gdfencepro.com / admin1234')
}

main()
  .catch(console.error)
  .finally(async () => { await prisma.$disconnect() })
