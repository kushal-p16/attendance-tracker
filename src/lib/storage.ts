export type Subject = {
  id: string
  subject_name: string
  total_classes: number
  attended_classes: number
  classes_until_ia: number
  created_at?: string
  updated_at?: string
}

export type HistoryItem = {
  id: string
  subject_id: string
  action: string
  total_classes: number
  attended_classes: number
  created_at: string
}

const SUBJECTS_KEY = 'attendance-tracker-subjects'
const HISTORY_KEY = 'attendance-tracker-history'
const THRESHOLD_KEY = 'attendance-tracker-threshold'

function read<T>(key: string, fallback: T): T {
  try {
    const value = window.localStorage.getItem(key)
    return value ? JSON.parse(value) as T : fallback
  } catch {
    return fallback
  }
}

export function loadSubjects(fallback: Subject[]): Subject[] {
  return read(SUBJECTS_KEY, fallback)
}

export function saveSubjects(subjects: Subject[]) {
  window.localStorage.setItem(SUBJECTS_KEY, JSON.stringify(subjects))
}

export function loadHistory(): HistoryItem[] {
  return read(HISTORY_KEY, [])
}

export function saveHistory(history: HistoryItem[]) {
  window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history))
}

export function loadThreshold(defaultValue: number): number {
  return read(THRESHOLD_KEY, defaultValue)
}

export function saveThreshold(threshold: number) {
  window.localStorage.setItem(THRESHOLD_KEY, JSON.stringify(threshold))
}
