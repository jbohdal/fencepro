/**
 * Does a job have its drawing? (Smart Schedule's "Need Drawing" tag; audit Oct
 * 26 2026: every job was tagged, even the one the customer drew on the
 * website.) Yes when the job is marked drawn, or its quote has a yard drawn
 * in the quote builder or the customer's own drawing from the website quote.
 */

export function hasDrawing(
  job: { drawingComplete?: boolean | null },
  quote: { layout?: { yard?: unknown | null; widgetDrawing?: unknown | null } | null } | null | undefined,
): boolean {
  return !!job.drawingComplete || !!quote?.layout?.yard || !!quote?.layout?.widgetDrawing
}
