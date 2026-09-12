export type AttendanceStatus = 'safe' | 'danger' | 'below'

export function calculateAttendance(attended: number, total: number): number | null {
  return total > 0 ? (attended / total) * 100 : null
}

export function calculateFutureAttendance(
  attended: number,
  total: number,
  futureClasses: number,
  bunks: number,
): number | null {
  const future = Math.max(0, futureClasses)
  const skipped = Math.min(Math.max(0, bunks), future)
  return calculateAttendance(attended + future - skipped, total + future)
}

export function calculateMaximumSafeBunks(
  attended: number,
  total: number,
  futureClasses: number,
  threshold: number,
): number {
  const future = Math.max(0, futureClasses)
  let safeBunks = 0

  for (let bunks = 0; bunks <= future; bunks += 1) {
    const result = calculateFutureAttendance(attended, total, future, bunks)
    if (result !== null && result >= threshold) safeBunks = bunks
  }

  return safeBunks
}

export function calculateClassesNeededForThreshold(
  attended: number,
  total: number,
  threshold: number,
): number {
  if (calculateAttendance(attended, total) !== null && (calculateAttendance(attended, total) as number) >= threshold) return 0

  let classes = 0
  while (calculateAttendance(attended + classes, total + classes) !== null && (calculateAttendance(attended + classes, total + classes) as number) < threshold) {
    classes += 1
    if (classes > 100000) return classes
  }
  return classes
}

export function getAttendanceStatus(
  attended: number,
  total: number,
  futureClasses: number,
  threshold: number,
): AttendanceStatus {
  const current = calculateAttendance(attended, total)
  if (current !== null && current < threshold) return 'below'
  return calculateMaximumSafeBunks(attended, total, futureClasses, threshold) > 0 ? 'safe' : 'danger'
}

export function formatAttendance(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(2)}%`
}
