import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const router = Router();

router.get('/', async (req: Request, res: Response) => {
  const items = await prisma.inventoryItem.findMany({ orderBy: { name: 'asc' } });

  const total = items.reduce((s, it) => s + Number(it.cost), 0);
  const totalsByCategory = items.reduce((acc: Record<string, number>, it) => {
    const cat = it.category || 'uncategorized';
    acc[cat] = (acc[cat] || 0) + Number(it.cost);
    return acc;
  }, {} as Record<string, number>);

  res.json({ items, total, totalsByCategory });
});

export default router;
