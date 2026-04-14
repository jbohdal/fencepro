/** Safely extract a string param from Express req.params or req.query */
export function str(val: string | string[] | undefined): string {
  if (Array.isArray(val)) return val[0] || ''
  return val || ''
}
