import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { PrismaClient, QuoteStatus } from '@prisma/client';
import { calculateQuote, calculateSections } from '../../shared/src/quoteEngine';

const prisma = new PrismaClient();
const router = Router();

const CreateQuoteSchema = z.object({
  customerId:          z.string(),
  jobSiteAddress:      z.string().optional(),
  jobSiteCity:         z.string().optional(),
  jobSiteState:        z.string().optional(),
  jobSiteZip:          z.string().optional(),
  fenceStyleId:        z.string(),
  runLengths:          z.array(z.number().positive()),
  cornerCount:         z.number().int().min(0).default(0),
  endCount:            z.number().int().min(0).default(0),
  walkGateCount:       z.number().int().min(0).default(0),
  doubleGateCount:     z.number().int().min(0).default(0),
  tearOutSections:     z.number().int().min(0).default(0),
  tearOutGates:        z.number().int().min(0).default(0),
  adjustedLaborHours:  z.number().min(0).default(0),
  adjustedMaterialCost: z.number().optional(),
  priceAdjust:         z.number().min(-0.20).max(0.20).default(0),
  hasSalesman:         z.boolean().default(false),
  addOns: z.array(z.object({
    name:     z.string(),
    qty:      z.number().int().positive(),
    unitCost: z.number().positive(),
  })).default([]),
  notes: z.string().optional(),
});

router.get('/', async (req: Request, res: Response) => {
  const { status, page = '1', limit = '20' } = req.query;
  const where: Record<string, unknown> = {};
  if (status) where.status = status;

  const [quotes, total] = await Promise.all([
    prisma.quote.findMany({
      where,
      include: {
        customer:   { select: { firstName: true, lastName: true, city: true } },
        createdBy:  { select: { name: true } },
        fenceStyle: { select: { name: true, category: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
    }),
    prisma.quote.count({ where }),
  ]);

  res.json({ data: quotes, total, page: Number(page), limit: Number(limit) });
});

router.get('/:id', async (req: Request, res: Response) => {
  const quote = await prisma.quote.findUniqueOrThrow({
    where: { id: req.params.id },
    include: {
      customer:   true,
      createdBy:  { select: { name: true, email: true } },
      fenceStyle: true,
      lineItems:  { include: { inventory: true } },
      addOns:     true,
      job:        true,
    },
  });
  res.json(quote);
});

router.post('/', async (req: Request, res: Response) => {
  const body = CreateQuoteSchema.parse(req.body);

  const [fenceStyle, config] = await Promise.all([
    prisma.fenceStyle.findUniqueOrThrow({ where: { id: body.fenceStyleId } }),
    getSystemConfig(),
  ]);

  // Legacy schema (root prisma) has no panelWidth column on FenceStyle, so we
  // derive it from category. Active code path uses style.panelWidth directly.
  const panelLength =
    fenceStyle.category === 'CHAINLINK' ? 10
    : /8'?/.test(fenceStyle.name) ? 8
    : 6;
  const sectionCount = calculateSections(body.runLengths, panelLength);
  const addonMaterialCost = body.addOns.reduce(
    (sum, a) => sum + a.qty * a.unitCost, 0
  );

  const result = calculateQuote({
    fenceStyle: {
      id:            fenceStyle.id,
      name:          fenceStyle.name,
      margin:        Number(fenceStyle.margin),
      sectionsPerMH: Number(fenceStyle.sectionsPerMH),
      mhPerWalkGate: Number(fenceStyle.mhPerWalkGate),
      mhPerDblGate:  Number(fenceStyle.mhPerDblGate),
    },
    sectionCount,
    walkGateCount:       body.walkGateCount,
    doubleGateCount:     body.doubleGateCount,
    tearOutSections:     body.tearOutSections,
    tearOutGates:        body.tearOutGates,
    materialCost:        addonMaterialCost + (body.adjustedMaterialCost ?? 0),
    adjustedLaborHours:  body.adjustedLaborHours,
    adjustedMaterialCost: body.adjustedMaterialCost,
    priceAdjust:         body.priceAdjust,
    hasSalesman:         body.hasSalesman,
    config,
  });

  const count = await prisma.quote.count();
  const quoteNumber = `Q-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`;

  const quote = await prisma.quote.create({
    data: {
      quoteNumber,
      customerId:      body.customerId,
      createdById:     'system',
      fenceStyleId:    body.fenceStyleId,
      jobSiteAddress:  body.jobSiteAddress,
      jobSiteCity:     body.jobSiteCity,
      jobSiteState:    body.jobSiteState,
      jobSiteZip:      body.jobSiteZip,
      runLengths:      body.runLengths,
      sectionCount,
      gateCount:       body.walkGateCount + body.doubleGateCount,
      cornerCount:     body.cornerCount,
      endCount:        body.endCount,
      tearOutSections: body.tearOutSections,
      tearOutGates:    body.tearOutGates,
      baseMH:          result.baseMH,
      adjustedMH:      result.adjustedMH,
      laborCost:       result.laborCost,
      materialCost:    result.materialCost,
      basePrice:       result.basePrice,
      priceAdjust:     body.priceAdjust,
      adjustedPrice:   result.adjustedPrice,
      margin:          Number(fenceStyle.margin),
      tearOutCost:     result.tearOutCost,
      grossMargin:     result.grossMargin,
      grossMarginPct:  result.grossMarginPct,
      hasSalesman:     body.hasSalesman,
      commissionPct:   result.commissionPct,
      commissionAmt:   result.commissionAmt,
      notes:           body.notes,
      addOns: { create: body.addOns },
    },
    include: { addOns: true, fenceStyle: true },
  });

  res.status(201).json(quote);
});

router.post('/:id/sell', async (req: Request, res: Response) => {
  const quote = await