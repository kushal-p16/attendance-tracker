import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowDownUp, BookOpen, Check, ChevronDown, Clock3, History, LogOut, Menu, Pencil, Plus, ShieldCheck, Trash2, TrendingUp, X } from 'lucide-react'
import './App.css'
import { calculateAttendance, calculateClassesNeededForThreshold, calculateFutureAttendance, calculateMaximumSafeBunks, formatAttendance, getAttendanceStatus } from './lib/calculations'
import { loadHistory, loadSubjects, loadThreshold, saveHistory, saveSubjects, saveThreshold } from './lib/storage'
import type { HistoryItem, Subject } from './lib/storage'
import { auth, db, firebaseConfigured } from './lib/firebase'
import { createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword, signOut as firebaseSignOut } from 'firebase/auth'
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, setDoc, updateDoc, where } from 'firebase/firestore'

const demoSubjects: Subject[] = [
  { id: 'ml', subject_name: 'Machine Learning', total_classes: 30, attended_classes: 27, classes_until_ia: 5 },
  { id: 'os', subject_name: 'Operating Systems', total_classes: 26, attended_classes: 20, classes_until_ia: 3 },
  { id: 'cn', subject_name: 'Computer Networks', total_classes: 18, attended_classes: 16, classes_until_ia: 8 },
]

type SortMode = 'attention' | 'name' | 'highest' | 'closest'

function App() {
  const [session, setSession] = useState<{ id: string; email?: string } | null>(firebaseConfigured ? null : { id: 'browser-user', email: 'student@browser.local' })
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login')
  const [subjects, setSubjects] = useState<Subject[]>(() => loadSubjects(firebaseConfigured ? [] : demoSubjects))
  const [history, setHistory] = useState<HistoryItem[]>(loadHistory)
  const [threshold, setThreshold] = useState(() => loadThreshold(85))
  const [sortMode, setSortMode] = useState<SortMode>('attention')
  const [modal, setModal] = useState<'subject' | 'settings' | 'history' | null>(null)
  const [editing, setEditing] = useState<Subject | null>(null)
  const [selectedHistory, setSelectedHistory] = useState<Subject | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const subjectCount = useRef(subjects.length)
  const historyCount = useRef(history.length)
  const subjectsRef = useRef(subjects)
  const pendingSubjectWrites = useRef(new Set<string>())
  const migrationInFlight = useRef(false)

  useEffect(() => saveSubjects(subjects), [subjects])
  useEffect(() => saveHistory(history), [history])
  useEffect(() => saveThreshold(threshold), [threshold])
  useEffect(() => { subjectCount.current = subjects.length }, [subjects.length])
  useEffect(() => { historyCount.current = history.length }, [history.length])
  useEffect(() => { subjectsRef.current = subjects }, [subjects])

  useEffect(() => {
    if (!auth) return
    return onAuthStateChanged(auth, (user) => setSession(user ? { id: user.uid, email: user.email ?? undefined } : null))
  }, [])

  useEffect(() => {
    if (!session || !db || !firebaseConfigured) return
    const firestore = db
    const unsubscribeSubjects = onSnapshot(
      query(collection(firestore, 'subjects'), where('userId', '==', session.id)),
      (snapshot) => {
        const cloudSubjects = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Subject)
        const cloudIds = new Set(cloudSubjects.map((subject) => subject.id))
        const pendingSubjectMissing = [...pendingSubjectWrites.current].some((id) => !cloudIds.has(id))
        if (pendingSubjectWrites.current.size > 0 && (cloudSubjects.length < subjectsRef.current.length || pendingSubjectMissing)) return
        if (cloudSubjects.length > 0) {
          setSubjects(cloudSubjects)
          return
        }

        // Retry migrating older Chrome-only data until Firestore confirms it.
        if (subjectsRef.current.length > 0 && !migrationInFlight.current) {
          migrationInFlight.current = true
          Promise.all(subjectsRef.current.map((subject) => setDoc(doc(firestore, 'subjects', subject.id), { ...subject, userId: session.id })))
            .catch(() => setMessage('Could not upload your saved subjects yet. They are still safe on this device.'))
            .finally(() => { migrationInFlight.current = false })
          return
        }

        // Keep the offline cache visible if a reconnect briefly reports an empty result.
        if (subjectsRef.current.length === 0) setSubjects(cloudSubjects)
      },
      () => setMessage('Could not sync subjects. Your latest changes remain saved on this device.')
    )
    const unsubscribeHistory = onSnapshot(
      query(collection(firestore, 'attendance_history'), where('userId', '==', session.id)),
      (snapshot) => {
        const cloudHistory = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as HistoryItem)
        if (cloudHistory.length > 0 || historyCount.current === 0) setHistory(cloudHistory)
      },
      () => setMessage('Could not sync attendance history. Your subject data is still saved.')
    )
    return () => { unsubscribeSubjects(); unsubscribeHistory() }
  }, [session])

  const sortedSubjects = useMemo(() => [...subjects].sort((a, b) => {
    const aAttendance = calculateAttendance(a.attended_classes, a.total_classes) ?? -1
    const bAttendance = calculateAttendance(b.attended_classes, b.total_classes) ?? -1
    if (sortMode === 'name') return a.subject_name.localeCompare(b.subject_name)
    if (sortMode === 'highest') return bAttendance - aAttendance
    if (sortMode === 'closest') return a.classes_until_ia - b.classes_until_ia
    return aAttendance - bAttendance
  }), [subjects, sortMode])
  const overall = subjects.reduce((sum, subject) => sum + subject.attended_classes, 0) / Math.max(1, subjects.reduce((sum, subject) => sum + subject.total_classes, 0)) * 100
  const safeCount = subjects.filter((subject) => (calculateAttendance(subject.attended_classes, subject.total_classes) ?? 0) >= threshold).length

  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const email = String(data.get('email'))
    const password = String(data.get('password'))
    if (!email || password.length < 6) return setMessage('Use a valid email and a password with at least 6 characters.')
    if (!auth || !firebaseConfigured) {
      setSession({ id: 'browser-user', email })
      setMessage('')
      return
    }
    try {
      const result = authMode === 'login' ? await signInWithEmailAndPassword(auth, email, password) : await createUserWithEmailAndPassword(auth, email, password)
      if (!result.user) setMessage('Unable to sign in. Please try again.')
    } catch (error) {
      const errorCode = error instanceof Error ? error.message : ''
      setMessage(errorCode.includes('auth/configuration-not-found')
        ? 'Firebase Authentication is not enabled yet. In Firebase Console, open Authentication > Sign-in method and enable Email/Password, then try again.'
        : errorCode.replace('Firebase: ', '') || 'Unable to sign in. Check your details and try again.')
    }
  }

  async function signOut() {
    if (auth) await firebaseSignOut(auth)
  }

  async function saveSubject(values: Omit<Subject, 'id'>, existingId?: string) {
    setSaving(true)
    const subjectId = existingId ?? crypto.randomUUID()
    const next = existingId ? subjects.map((subject) => subject.id === existingId ? { ...subject, ...values } : subject) : [...subjects, { ...values, id: subjectId }]
    setSubjects(next)
    if (db && session && firebaseConfigured) {
      pendingSubjectWrites.current.add(subjectId)
      try {
        if (existingId) await updateDoc(doc(db, 'subjects', existingId), values)
        else await setDoc(doc(db, 'subjects', subjectId), { ...values, userId: session.id })
      } catch {
        setMessage('Could not sync this subject yet. It remains saved on this device.')
      } finally {
        pendingSubjectWrites.current.delete(subjectId)
      }
    }
    setSaving(false)
    setModal(null)
  }

  async function deleteSubject(subject: Subject) {
    if (!window.confirm(`Are you sure you want to delete ${subject.subject_name}?\n\nThis cannot be undone.`)) return
    setSubjects((current) => current.filter((item) => item.id !== subject.id))
    if (db && session && firebaseConfigured) {
      pendingSubjectWrites.current.add(subject.id)
      try {
        await deleteDoc(doc(db, 'subjects', subject.id))
      } catch {
        setMessage('Could not delete this subject from Firebase. It remains available on another device.')
      } finally {
        pendingSubjectWrites.current.delete(subject.id)
      }
    }
  }

  async function updateSubject(subject: Subject, action: 'attend' | 'bunk' | 'total' | 'ia', amount = 1) {
    const next = { ...subject }
    if (action === 'attend') { next.total_classes += amount; next.attended_classes += amount }
    if (action === 'bunk') next.total_classes += amount
    if (action === 'total') next.total_classes = Math.max(next.attended_classes, next.total_classes + amount)
    if (action === 'ia') next.classes_until_ia = Math.max(0, next.classes_until_ia + amount)
    setSubjects((current) => current.map((item) => item.id === subject.id ? next : item))
    const historyAction = action === 'attend' ? 'Attended class' : action === 'bunk' ? 'Bunked class' : action === 'ia' ? 'Updated IA countdown' : 'Updated total classes'
    const historyItem = { subject_id: subject.id, action: historyAction, total_classes: next.total_classes, attended_classes: next.attended_classes, created_at: new Date().toISOString() }
    setHistory((current) => [{ id: crypto.randomUUID(), ...historyItem }, ...current])
    if (db && session && firebaseConfigured) {
      await updateDoc(doc(db, 'subjects', subject.id), { total_classes: next.total_classes, attended_classes: next.attended_classes, classes_until_ia: next.classes_until_ia })
      await addDoc(collection(db, 'attendance_history'), { ...historyItem, userId: session.id })
    }
  }

  if (!session) return <AuthScreen mode={authMode} setMode={setAuthMode} onSubmit={authenticate} message={message} />

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark"><BookOpen size={18} /></div><span>Attendance <strong>Tracker</strong></span></div>
      <div className="top-actions"><span className="sync-state">{saving ? 'Saving...' : <><Check size={14} /> All changes saved</>}</span><button className="icon-btn mobile-menu" aria-label="Open menu"><Menu size={20} /></button><button className="avatar" onClick={() => setModal('settings')}>A</button></div>
    </header>
    <main className="page-wrap">
      <section className="welcome-row"><div><p className="eyebrow">SATURDAY, 12 SEPTEMBER 2026</p><h1>Good morning, Kushal<span className="accent-dot">.</span></h1><p className="lede">Keep your attendance in the safe zone before the next IA.</p></div><button className="primary-btn" onClick={() => { setEditing(null); setModal('subject') }}><Plus size={18} /> Add subject</button></section>
      <div className="setup-note"><ShieldCheck size={18} /><span>{firebaseConfigured ? 'Connected to Firebase. Your account syncs across devices.' : 'Preview mode: saved in this browser. Add Firebase keys to sync across devices.'}</span></div>
      {message && <div className="notice">{message}<button onClick={() => setMessage('')} aria-label="Dismiss"><X size={16} /></button></div>}
      <section className="stat-grid"><Stat label="Overall attendance" value={`${overall.toFixed(2)}%`} note="Across all subjects" icon={<TrendingUp size={18} />} /><Stat label="Subjects on track" value={`${safeCount}/${subjects.length}`} note={`Above ${threshold}% threshold`} icon={<ShieldCheck size={18} />} /><Stat label="Needs attention" value={`${subjects.length - safeCount}`} note="Subjects below target" icon={<Clock3 size={18} />} tone="warm" /></section>
      <div className="content-heading"><div><p className="eyebrow">YOUR SUBJECTS</p><h2>Attendance overview</h2></div><label className="sort-control"><ArrowDownUp size={15} /><select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}><option value="attention">Lowest attendance first</option><option value="name">Subject name</option><option value="highest">Highest attendance first</option><option value="closest">Closest IA</option></select><ChevronDown size={14} /></label></div>
      {sortedSubjects.length === 0 ? <EmptyState onAdd={() => setModal('subject')} /> : <div className="subject-grid">{sortedSubjects.map((subject) => <SubjectCard key={subject.id} subject={subject} threshold={threshold} onUpdate={updateSubject} onEdit={() => { setEditing(subject); setModal('subject') }} onDelete={() => deleteSubject(subject)} onHistory={() => { setSelectedHistory(subject); setModal('history') }} />)}</div>}
    </main>
    <footer><span>Attendance Tracker</span><span>Made for staying on track.</span><span className="watermark">Created by KUSHAL P</span></footer>
    {modal === 'subject' && <SubjectModal initial={editing} onClose={() => setModal(null)} onSave={saveSubject} />}
    {modal === 'settings' && <SettingsModal threshold={threshold} setThreshold={setThreshold} email={session.email} onClose={() => setModal(null)} onSignOut={signOut} />}
    {modal === 'history' && selectedHistory && <HistoryModal subject={selectedHistory} history={history.filter((item) => item.subject_id === selectedHistory.id)} onClose={() => setModal(null)} />}
  </div>
}

function AuthScreen({ mode, setMode, onSubmit, message }: { mode: 'login' | 'signup'; setMode: (mode: 'login' | 'signup') => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; message: string }) {
  return <div className="auth-shell"><div className="auth-aside"><div className="brand"><div className="brand-mark"><BookOpen size={18} /></div><span>Attendance <strong>Tracker</strong></span></div><div className="auth-copy"><p className="eyebrow">YOUR SEMESTER, CLEARLY</p><h1>Make every class count<span className="accent-dot">.</span></h1><p>Know where you stand, plan your next IA, and keep your attendance comfortably above the line.</p></div><div className="quote">“The best time to track attendance was the first week. The second best time is now.”</div></div><div className="auth-panel"><div className="auth-form-wrap"><p className="eyebrow">{mode === 'login' ? 'WELCOME BACK' : 'GET STARTED'}</p><h2>{mode === 'login' ? 'Sign in to your tracker' : 'Create your account'}</h2><p className="muted">Your subjects stay synced wherever you study.</p><form onSubmit={onSubmit}><label>Email address<input name="email" type="email" placeholder="you@university.edu" required /></label><label>Password<input name="password" type="password" placeholder="At least 6 characters" required minLength={6} /></label>{message && <div className="form-error">{message}</div>}<button className="primary-btn full" type="submit">{mode === 'login' ? 'Sign in' : 'Create account'} <TrendingUp size={16} /></button></form><button className="text-btn" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>{mode === 'login' ? 'New here? Create an account' : 'Already have an account? Sign in'}</button></div></div></div>
}

function Stat({ label, value, note, icon, tone = '' }: { label: string; value: string; note: string; icon: React.ReactNode; tone?: string }) { return <div className={`stat-card ${tone}`}><div className="stat-top"><span>{label}</span><span className="stat-icon">{icon}</span></div><strong>{value}</strong><small>{note}</small></div> }

function SubjectCard({ subject, threshold, onUpdate, onEdit, onDelete, onHistory }: { subject: Subject; threshold: number; onUpdate: (subject: Subject, action: 'attend' | 'bunk' | 'total' | 'ia', amount?: number) => void; onEdit: () => void; onDelete: () => void; onHistory: () => void }) {
  const attendance = calculateAttendance(subject.attended_classes, subject.total_classes)
  const status = getAttendanceStatus(subject.attended_classes, subject.total_classes, subject.classes_until_ia, threshold)
  const safeBunks = calculateMaximumSafeBunks(subject.attended_classes, subject.total_classes, subject.classes_until_ia, threshold)
  const needed = calculateClassesNeededForThreshold(subject.attended_classes, subject.total_classes, threshold)
  const nextSafe = safeBunks > 0 ? calculateFutureAttendance(subject.attended_classes, subject.total_classes, subject.classes_until_ia, safeBunks) : null
  return <article className={`subject-card ${status}`}><div className="card-head"><div><h3>{subject.subject_name}</h3><span className="status-pill"><span />{status === 'safe' ? 'On track' : status === 'danger' ? 'Watch closely' : 'Below target'}</span></div><div className="card-menu"><button className="icon-btn" title="View history" onClick={onHistory}><History size={17} /></button><button className="icon-btn" title="Edit subject" onClick={onEdit}><Pencil size={17} /></button><button className="icon-btn danger-btn" title="Delete subject" onClick={onDelete}><Trash2 size={17} /></button></div></div><div className="attendance-line"><div><span className="label">CURRENT ATTENDANCE</span><strong>{formatAttendance(attendance)}</strong></div><div className="fraction"><b>{subject.attended_classes}</b><span>/</span>{subject.total_classes} classes</div></div><div className="progress-track"><div style={{ width: `${Math.min(100, attendance ?? 0)}%` }} /></div><div className="control-grid"><Counter label="Total classes" value={subject.total_classes} onMinus={() => onUpdate(subject, 'total', -1)} onPlus={() => onUpdate(subject, 'total')} /><Counter label="Attended" value={subject.attended_classes} onMinus={() => subject.attended_classes > 0 && onUpdate(subject, 'total', -1) || undefined} onPlus={() => onUpdate(subject, 'attend')} /><Counter label="Classes until IA" value={subject.classes_until_ia} onMinus={() => onUpdate(subject, 'ia', -1)} onPlus={() => onUpdate(subject, 'ia')} /></div><div className="bunk-panel">{status === 'below' ? <><div className="bunk-label danger-text">BELOW {threshold}%</div><strong>Attend {needed} consecutive class{needed === 1 ? '' : 'es'}</strong><span>to reach the attendance threshold.</span></> : status === 'safe' ? <><div className="bunk-label safe-text">YOU CAN BUNK</div><strong>{safeBunks} class{safeBunks === 1 ? '' : 'es'} safely</strong><span>After {safeBunks} bunks: <b>{formatAttendance(nextSafe)}</b></span></> : <><div className="bunk-label warning-text">CAN'T BUNK NOW</div><strong>Attend upcoming classes</strong><span>to maintain {threshold}% attendance.</span></>}<button className="bunk-action" onClick={() => onUpdate(subject, 'bunk')}><Plus size={14} /> Log a bunk</button></div></article>
}

function Counter({ label, value, onMinus, onPlus }: { label: string; value: number; onMinus: () => void; onPlus: () => void }) { return <div className="counter"><span>{label}</span><div><button onClick={onMinus} aria-label={`Decrease ${label}`}><span>−</span></button><b>{value}</b><button onClick={onPlus} aria-label={`Increase ${label}`}><Plus size={15} /></button></div></div> }
function EmptyState({ onAdd }: { onAdd: () => void }) { return <div className="empty-state"><div className="empty-icon"><BookOpen size={25} /></div><h3>No subjects yet.</h3><p>Add your first subject to start tracking attendance.</p><button className="primary-btn" onClick={onAdd}><Plus size={17} /> Add subject</button></div> }

function SubjectModal({ initial, onClose, onSave }: { initial: Subject | null; onClose: () => void; onSave: (values: Omit<Subject, 'id'>, id?: string) => void }) { const [error, setError] = useState(''); const [form, setForm] = useState({ subject_name: initial?.subject_name ?? '', total_classes: initial?.total_classes ?? 0, attended_classes: initial?.attended_classes ?? 0, classes_until_ia: initial?.classes_until_ia ?? 0 }); const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: key === 'subject_name' ? value : Math.max(0, Number(value)) })); function submit(event: FormEvent) { event.preventDefault(); if (!form.subject_name.trim()) return setError('Give this subject a name.'); if (form.attended_classes > form.total_classes) return setError('Attended classes cannot exceed total classes.'); onSave({ ...form, subject_name: form.subject_name.trim() }, initial?.id) } return <Modal title={initial ? 'Edit subject' : 'Add a subject'} onClose={onClose}><form className="modal-form" onSubmit={submit}><label>Subject name<input value={form.subject_name} onChange={(e) => update('subject_name', e.target.value)} placeholder="e.g. Machine Learning" /></label><div className="form-row"><label>Total classes<input type="number" min="0" value={form.total_classes} onChange={(e) => update('total_classes', e.target.value)} /></label><label>Classes attended<input type="number" min="0" value={form.attended_classes} onChange={(e) => update('attended_classes', e.target.value)} /></label></div><label>Classes until next IA<input type="number" min="0" value={form.classes_until_ia} onChange={(e) => update('classes_until_ia', e.target.value)} /></label>{error && <div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="secondary-btn" onClick={onClose}>Cancel</button><button className="primary-btn" type="submit">{initial ? 'Save changes' : 'Add subject'}</button></div></form></Modal> }
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) { return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal" onMouseDown={(e) => e.stopPropagation()}><div className="modal-head"><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Close"><X size={19} /></button></div>{children}</div></div> }
function SettingsModal({ threshold, setThreshold, email, onClose, onSignOut }: { threshold: number; setThreshold: (value: number) => void; email?: string; onClose: () => void; onSignOut: () => void }) { return <Modal title="Settings" onClose={onClose}><div className="settings-content"><div className="account-row"><div className="avatar large">A</div><div><strong>{email || 'Demo student'}</strong><span>Student account</span></div></div><label>Attendance threshold<span className="input-suffix"><input type="number" min="1" max="100" value={threshold} onChange={(e) => setThreshold(Math.min(100, Math.max(1, Number(e.target.value))))} /><b>%</b></span></label><p className="muted small">Every warning and bunk calculation uses this threshold.</p><button className="signout-btn" onClick={onSignOut}><LogOut size={16} /> Sign out</button></div></Modal> }
function HistoryModal({ subject, history, onClose }: { subject: Subject; history: HistoryItem[]; onClose: () => void }) { return <Modal title={`${subject.subject_name} history`} onClose={onClose}><div className="history-list">{history.length === 0 ? <p className="muted">No changes recorded yet.</p> : history.map((item) => <div className="history-item" key={item.id}><div className="history-dot" /><div><strong>{item.action}</strong><span>{new Date(item.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</span></div><b>{item.total_classes ? `${item.attended_classes}/${item.total_classes}` : '—'}</b></div>)}</div></Modal> }

export default App
