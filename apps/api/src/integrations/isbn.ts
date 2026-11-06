import { Isbn13 } from '../modules/books/schemas'

export function isbn13(value: unknown) {
  const parsed = Isbn13.safeParse(typeof value === 'string' ? value.replace(/[\s-]/g, '') : value)
  return parsed.success ? parsed.data : null
}

export function isbn10(value: string) {
  const digits = value.replace(/[\s-]/g, '').toUpperCase()
  if (!/^\d{9}[\dX]$/.test(digits)) return null
  const sum = [...digits].reduce((total, digit, index) => total + (digit === 'X' ? 10 : Number(digit)) * (10 - index), 0)
  return sum % 11 === 0 ? digits : null
}

export function convertIsbn10(value: string) {
  const body = `978${value.slice(0, 9)}`
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0)
  return `${body}${(10 - sum % 10) % 10}`
}

export function normalizeIsbn(value: string) {
  const digits = value.replace(/^urn:isbn:/i, '').normalize('NFKC')
  const legacy = isbn10(digits)
  return isbn13(digits) ?? (legacy ? convertIsbn10(legacy) : null)
}
