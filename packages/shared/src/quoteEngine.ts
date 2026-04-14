export interface FenceStyleConfig {
  id: string;
  name: string;
  margin: number;
  sectionsPerMH: number;
  mhPerWalkGate: number;
  mhPerDblGate: number;
}

export interface SystemConfig {
  manHourRate: number;
  commissionSalesman: number;
  commissionNonSalesman: number;
  overheadRate: number;
  tearOutFenceCost: number;
  tearOutGateCost: number;
}

export interface QuoteInputs {
  fenceStyle: FenceStyleConfig;
  sectionCount: number;
  walkGateCount: number;
  doubleGateCount: number;
  tearOutSections: number;
  tearOutGates: number;
  materialCost: number;
  adjustedLaborHours: number;
  adjustedMaterialCost?: number;
  priceAdjust: number;
  hasSalesman: boolean;
  config: SystemConfig;
}

export interface QuoteResult {
  baseMH: number;
  adjustedMH: number;
  laborCost: number;
  materialCost: number;
  tearOutCost: number;
  totalCOGS: number;
  basePrice: number;
  priceAdjust: number;
  adjustedPrice: number;
  commissionPct: number;
  commissionAmt: number;
  grossMargin: number;
  grossMarginPct: number;
  marginStatus: 'good' | 'warning' | 'danger';
}

export function calculateQuote(inputs: QuoteInputs): QuoteResult {
  const { fenceStyle, config } = inputs;

  const sectionMH = inputs.sectionCount / fenceStyle.sectionsPerMH;
  const gateMH =
    inputs.walkGateCount * fenceStyle.mhPerWalkGate +
    inputs.doubleGateCount * fenceStyle.mhPerDblGate;
  const baseMH = sectionMH + gateMH;
  const adjustedMH = baseMH + (inputs.adjustedLaborHours ?? 0);

  const laborCost = adjustedMH * config.manHourRate;
  const tearOutCost =
    inputs.tearOutSections * config.tearOutFenceCost +
    inputs.tearOutGates * config.tearOutGateCost;
  const materialCost = inputs.adjustedMaterialCost ?? inputs.materialCost;
  const totalCOGS = laborCost + materialCost + tearOutCost;

  const basePrice = totalCOGS / (1 - fenceStyle.margin);
  const adjustedPrice = basePrice * (1 + inputs.priceAdjust);

  const commissionPct = inputs.hasSalesman
    ? config.commissionSalesman
    : config.commissionNonSalesman;
  const commissionAmt = adjustedPrice * commissionPct;

  const grossMargin = adjustedPrice - totalCOGS - commissionAmt;
  const grossMarginPct = adjustedPrice > 0 ? grossMargin / adjustedPrice : 0;

  let marginStatus: 'good' | 'warning' | 'danger';
  if (grossMarginPct >= 0.62) {
    marginStatus = 'good';
  } else if (grossMarginPct >= 0.55) {
    marginStatus = 'warning';
  } else {
    marginStatus = 'danger';
  }

  return {
    baseMH: r2(baseMH),
    adjustedMH: r2(adjustedMH),
    laborCost: r2(laborCost),
    materialCost: r2(materialCost),
    tearOutCost: r2(tearOutCost),
    totalCOGS: r2(totalCOGS),
    basePrice: r2(basePrice),
    priceAdjust: inputs.priceAdjust,
    adjustedPrice: r2(adjustedPrice),
    commissionPct: r4(commissionPct),
    commissionAmt: r2(commissionAmt),
    grossMargin: r2(grossMargin),
    grossMarginPct: r4(grossMarginPct),
    marginStatus,
  };
}

export function calculateSections(runLengthsFt: number[]): number {
  const totalFt = runLengthsFt.reduce((sum, len) => sum + len, 0);
  return Math.ceil(totalFt / 8);
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount);
}

export function formatPercent(pct: number, decimals = 1): string {
  return `${(pct * 100).toFixed(decimals)}%`;
}

function r2(n: number): number { return Math.round(n * 100) / 100; }
function r4(n: number): number { return Math.round(n * 10000) / 10000; }