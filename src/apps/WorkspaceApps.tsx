import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, KeyboardEvent } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Check, ChevronLeft, File, FileImage, FileText, FolderOpen, Music2, Pause, Play, Plus, RotateCcw, Search, Trash2, Video, X } from 'lucide-react';
import { calculate } from './calculator';
import { deleteFile, loadFiles, saveFiles } from './fileStore';
import type { WorkspaceFile } from './fileStore';
import './apps.css';

export type BuiltinAppType = 'notes' | 'files' | 'focus' | 'calculator';

const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';

interface Note { id: string; title: string; body: string; updatedAt: number }
const notesKey = 'depth-notes-v1';
const welcomeNotes = (): Note[] => [
  {
    id: 'welcome', title: 'A little room to think',
    body: 'A fresh perspective. A place for your thoughts.\n\nSpread out your windows, find your angle, and make this space your own.\n\nThis is a real notebook. Everything you write here is saved on this device as you go.\n\nWhat will you make today?',
    updatedAt: Date.now(),
  },
  { id: 'ideas', title: 'Ideas, still taking shape', body: 'A small collection of things worth exploring.\n\n— Build something just for the joy of it\n— Make room for a little more focus\n— See an everyday thing from a new angle', updatedAt: Date.now() },
];

function readNotes(): { notes: Note[]; error: string } {
  try {
    const raw = localStorage.getItem(notesKey);
    if (!raw) return { notes: welcomeNotes(), error: '' };
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value) || !value.every((note) => note && typeof note.id === 'string' && typeof note.title === 'string' && typeof note.body === 'string' && typeof note.updatedAt === 'number')) throw new Error('Saved notes could not be read.');
    return { notes: value, error: '' };
  } catch { return { notes: welcomeNotes(), error: 'Saved notes could not be read. Your browser may have disabled local storage.' }; }
}

function NotesApp() {
  const [initial] = useState(readNotes);
  const [notes, setNotes] = useState(initial.notes);
  const [activeId, setActiveId] = useState(initial.notes[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const [storageError, setStorageError] = useState(initial.error);
  const [saved, setSaved] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const active = notes.find((note) => note.id === activeId);
  const filtered = notes.filter((note) => `${note.title} ${note.body}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  useEffect(() => {
    setSaved(false);
    const timer = window.setTimeout(() => {
      try { localStorage.setItem(notesKey, JSON.stringify(notes)); setStorageError(''); setSaved(true); }
      catch { setStorageError('Your changes are not saved. Local storage is full or unavailable. Keep this window open and copy your notes somewhere safe.'); }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [notes]);

  // Flush the latest edits when the app closes before the debounce completes.
  const latestNotes = useRef(notes);
  latestNotes.current = notes;
  useEffect(() => {
    const flush = () => { try { localStorage.setItem(notesKey, JSON.stringify(latestNotes.current)); } catch { /* The visible save status reports storage failure while open. */ } };
    window.addEventListener('pagehide', flush);
    return () => { window.removeEventListener('pagehide', flush); flush(); };
  }, []);

  function createNote() {
    const note = { id: uid(), title: '', body: '', updatedAt: Date.now() };
    setNotes((current) => [note, ...current]); setActiveId(note.id); setQuery(''); setPendingDelete(null);
  }
  function updateNote(field: 'title' | 'body', value: string) {
    setNotes((current) => current.map((note) => note.id === activeId ? { ...note, [field]: value, updatedAt: Date.now() } : note));
  }
  function removeNote(id: string) {
    const next = notes.filter((note) => note.id !== id);
    setNotes(next); setActiveId(next[0]?.id ?? ''); setPendingDelete(null);
  }
  function exportNote() {
    if (!active) return;
    const title = active.title.trim() || 'Untitled note';
    const blob = new Blob([`${title}\n\n${active.body}\n`], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${title.replace(/[\\/:*?"<>|]/g, '-').slice(0, 100)}.txt`;
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <div className="app-root app-notes">
    <aside className="app-notes-sidebar" aria-label="Your notes">
      <div className="app-sidebar-heading"><span>YOUR NOTES</span><button className="app-icon-button" onClick={createNote} title="New note" aria-label="New note"><Plus size={16} /></button></div>
      <label className="app-note-search"><Search size={13} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search notes" aria-label="Search notes" /></label>
      <div className="app-note-list">
        {filtered.map((note) => <button className={`app-note-row${note.id === activeId ? ' app-selected' : ''}`} key={note.id} onClick={() => { setActiveId(note.id); setPendingDelete(null); }} aria-pressed={note.id === activeId}>
          <strong>{note.title.trim() || 'Untitled note'}</strong><span>{note.body.trim().split('\n').find(Boolean) || 'A fresh page'}</span>
        </button>)}
        {filtered.length === 0 && <p className="app-sidebar-empty">{query ? 'No matching notes.' : 'Start with a fresh page.'}</p>}
      </div>
      <span className="app-note-count">{notes.length} {notes.length === 1 ? 'note' : 'notes'}</span>
    </aside>
    <div className="app-note-main">
      {active ? <>
        <div className="app-note-meta"><span>{new Date(active.updatedAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}</span><div className="app-note-actions"><button className="app-icon-button" aria-label="Export note as text" title="Export note as text" onClick={exportNote}><ArrowDownToLine size={14} /></button><button className="app-icon-button" aria-label="Delete this note" title="Delete this note" onClick={() => setPendingDelete(active.id)}><Trash2 size={14} /></button></div></div>
        {pendingDelete === active.id && <div className="app-delete-confirm" role="alert"><span>Delete this note?</span><button onClick={() => removeNote(active.id)}>Delete</button><button onClick={() => setPendingDelete(null)}>Keep</button></div>}
        <input className="app-note-title" placeholder="Untitled note" aria-label="Note title" value={active.title} onChange={(event) => updateNote('title', event.target.value)} />
        <textarea className="app-note-body" placeholder="Let your thoughts take shape…" aria-label="Note body" value={active.body} onChange={(event) => updateNote('body', event.target.value)} spellCheck />
        <div className="app-note-status">{!storageError && <><Check size={11} aria-hidden="true" /><span>{saved ? 'Saved on this device' : 'Saving…'}</span></>}<span>{active.body.trim() ? active.body.trim().split(/\s+/).length : 0} words</span></div>
      </> : <div className="app-empty"><FileText size={28} strokeWidth={1.4} /><h3>A fresh page awaits.</h3><p>Give your next idea a little room.</p><button className="app-primary-button" onClick={createNote}>New note</button></div>}
      {storageError && <p className="app-error" role="alert">{storageError}</p>}
    </div>
  </div>;
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function FileTypeIcon({ type }: { type: string }) {
  const Icon = type.startsWith('image/') ? FileImage : type.startsWith('audio/') ? Music2 : type.startsWith('video/') ? Video : type.startsWith('text/') ? FileText : File;
  return <Icon size={23} strokeWidth={1.4} aria-hidden="true" />;
}

function FilePreview({ file, onBack }: { file: WorkspaceFile; onBack: () => void }) {
  const [url, setUrl] = useState('');
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState('');
  const isText = file.type.startsWith('text/') || /\.(txt|md|json|csv|log|yaml|yml|js|jsx|ts|tsx|css|html|xml|sh|swift|py)$/i.test(file.name);
  useEffect(() => {
    let current = true;
    const objectUrl = URL.createObjectURL(file.blob); setUrl(objectUrl); setText(null); setError('');
    if (isText) file.blob.slice(0, 200_000).text().then((content) => { if (current) setText(content); }).catch(() => { if (current) setError('This file could not be read. You can still download it.'); });
    return () => { current = false; URL.revokeObjectURL(objectUrl); };
  }, [file, isText]);
  return <div className="app-file-preview">
    <div className="app-file-preview-heading"><button className="app-icon-button" onClick={onBack} aria-label="Back to files"><ChevronLeft size={18} /></button><strong title={file.name}>{file.name}</strong><a className="app-icon-button" href={url || undefined} download={file.name} title="Download file" aria-label={`Download ${file.name}`}><ArrowDownToLine size={16} /></a></div>
    <div className="app-preview-content">
      {error ? <p className="app-error" role="alert">{error}</p> : file.type.startsWith('image/') ? <img src={url || undefined} alt={file.name} onError={() => setError('This image format cannot be previewed here. You can still download it.')} />
        : file.type.startsWith('audio/') ? <div className="app-media-preview"><Music2 size={42} strokeWidth={1.2} /><audio controls src={url || undefined} onError={() => setError('This audio format cannot be previewed here. You can still download it.')} /></div>
        : file.type.startsWith('video/') ? <video controls src={url || undefined} onError={() => setError('This video format cannot be previewed here. You can still download it.')} />
        : isText ? <><pre className="app-text-preview">{text ?? 'Opening file…'}</pre>{file.size > 200_000 && <p className="app-preview-note">Preview shows the first 200 KB. Download for the complete file.</p>}</>
        : <div className="app-empty"><FileTypeIcon type={file.type} /><h3>{file.name}</h3><p>No preview for this file type.</p><a className="app-primary-button" href={url || undefined} download={file.name}>Download file</a></div>}
    </div>
    <div className="app-file-footer"><span>{formatBytes(file.size)}</span><span>{file.type || 'Unknown file type'}</span></div>
  </div>;
}

function FilesApp() {
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const mutationInFlight = useRef(false);
  useEffect(() => {
    let current = true;
    loadFiles().then((stored) => { if (current) setFiles(stored); }).catch((failure) => { if (current) setError(`File storage could not open. ${errorText(failure)}`); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, []);
  async function importFiles(input: FileList | null) {
    if (!input?.length || mutationInFlight.current || loading) return;
    mutationInFlight.current = true; setBusy(true); setError('');
    const incoming = Array.from(input);
    const allowed = incoming.filter((file) => file.size <= 100 * 1024 * 1024);
    const skipped = incoming.length - allowed.length;
    const records: WorkspaceFile[] = allowed.map((file, index) => ({ id: uid(), name: file.name, type: file.type, size: file.size, addedAt: Date.now() + index, blob: file }));
    try {
      if (records.length) { await saveFiles(records); setFiles((current) => [...records.reverse(), ...current]); setSelected(null); }
      if (skipped) setError(`${skipped} ${skipped === 1 ? 'file was' : 'files were'} skipped. Each file must be 100 MB or smaller.`);
    } catch (failure) { setError(`These files were not imported. Storage may be full or unavailable. ${errorText(failure)}`); }
    finally { mutationInFlight.current = false; setBusy(false); if (fileInput.current) fileInput.current.value = ''; }
  }
  async function removeFile(id: string) {
    if (mutationInFlight.current) return;
    mutationInFlight.current = true; setBusy(true); setError('');
    try { await deleteFile(id); setFiles((current) => current.filter((file) => file.id !== id)); setPendingDelete(null); }
    catch (failure) { setError(`This file was not removed. ${errorText(failure)}`); }
    finally { mutationInFlight.current = false; setBusy(false); }
  }
  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault(); dragDepth.current = 0; setDragging(false); void importFiles(event.dataTransfer.files);
  }
  const preview = files.find((file) => file.id === selected);
  const visibleFiles = files.filter((file) => file.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <div className={`app-root app-files${dragging ? ' app-drop-active' : ''}`} onDragEnter={(event) => { event.preventDefault(); dragDepth.current++; setDragging(true); }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = busy || loading ? 'none' : 'copy'; }} onDragLeave={(event) => { event.preventDefault(); dragDepth.current--; if (dragDepth.current <= 0) setDragging(false); }} onDrop={handleDrop}>
    <input ref={fileInput} type="file" multiple className="app-visually-hidden" tabIndex={-1} aria-label="Import files" onChange={(event: ChangeEvent<HTMLInputElement>) => void importFiles(event.target.files)} />
    {preview ? <FilePreview file={preview} onBack={() => setSelected(null)} /> : <>
      <div className="app-files-heading"><div><h2>Your collection</h2><p>A few things, close at hand.</p></div><button className="app-primary-button" onClick={() => fileInput.current?.click()} disabled={busy || loading}><Plus size={14} />{busy ? 'Importing…' : 'Import'}</button></div>
      {files.length > 0 && <label className="app-file-search"><Search size={14} aria-hidden="true" /><input aria-label="Find a file" placeholder="Find a file" value={query} onChange={(event) => setQuery(event.target.value)} /></label>}
      <div className="app-files-list">
        {loading ? <div className="app-empty"><p>Opening your collection…</p></div> : files.length === 0 ? <div className="app-empty app-files-empty"><FolderOpen size={38} strokeWidth={1.15} /><h3>Bring a few things with you.</h3><p>Drop files here or import from your Mac.<br />Images, documents, music, and more.</p><button className="app-text-button" onClick={() => fileInput.current?.click()} disabled={busy}><ArrowUpFromLine size={14} />Choose files</button></div> : visibleFiles.length === 0 ? <div className="app-empty"><p>No files match “{query}”.</p></div> : visibleFiles.map((file) => <div className="app-file-row" key={file.id}>
          <button className="app-file-open" onClick={() => setSelected(file.id)}><FileTypeIcon type={file.type} /><span><strong>{file.name}</strong><small>{formatBytes(file.size)} · {new Date(file.addedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small></span></button>
          {pendingDelete === file.id ? <span className="app-file-remove-confirm"><button disabled={busy} onClick={() => void removeFile(file.id)} aria-label={`Confirm remove ${file.name}`}>Remove?</button><button className="app-icon-button" onClick={() => setPendingDelete(null)} aria-label="Cancel removal"><X size={14} /></button></span> : <button className="app-icon-button app-file-delete" disabled={busy} onClick={() => setPendingDelete(file.id)} aria-label={`Remove ${file.name}`} title="Remove file"><Trash2 size={14} /></button>}
        </div>)}
      </div>
      <div className="app-file-footer"><span>{files.length} {files.length === 1 ? 'file' : 'files'}{files.length > 0 ? ` · ${formatBytes(files.reduce((sum, file) => sum + file.size, 0))}` : ''}</span><span>Stored in this workspace</span></div>
    </>}
    {error && <p className="app-error" role="alert">{error}</p>}
    {dragging && <div className="app-drop-overlay"><ArrowDownToLine size={30} /><strong>{busy || loading ? 'Please wait a moment' : 'Drop to add to your collection'}</strong></div>}
  </div>;
}

interface TimerState { duration: number; remaining: number; deadline: number | null; complete: boolean }
const focusKey = 'depth-focus-v1';
function initialTimer(): TimerState {
  const fallback = { duration: 25 * 60, remaining: 25 * 60, deadline: null, complete: false };
  try {
    const stored = JSON.parse(localStorage.getItem(focusKey) || 'null') as TimerState | null;
    if (!stored || ![300, 900, 1500, 3000].includes(stored.duration) || !Number.isFinite(stored.remaining) || stored.remaining < 0 || stored.remaining > stored.duration || !(stored.deadline === null || Number.isFinite(stored.deadline))) return fallback;
    if (stored.deadline !== null) { const remaining = Math.max(0, Math.min(stored.duration, Math.ceil((stored.deadline - Date.now()) / 1000))); return { ...stored, remaining, deadline: remaining > 0 ? stored.deadline : null, complete: remaining === 0 }; }
    return { ...stored, complete: stored.remaining === 0 };
  } catch { return fallback; }
}

function FocusApp() {
  const [timer, setTimer] = useState(initialTimer);
  const [storageError, setStorageError] = useState(false);
  const running = timer.deadline !== null;
  useEffect(() => {
    try { localStorage.setItem(focusKey, JSON.stringify(timer)); setStorageError(false); }
    catch { setStorageError(true); }
  }, [timer]);
  useEffect(() => {
    if (timer.deadline === null) return;
    const tick = () => setTimer((current) => {
      if (current.deadline === null) return current;
      const remaining = Math.max(0, Math.ceil((current.deadline - Date.now()) / 1000));
      if (remaining === current.remaining) return current;
      return { ...current, remaining, deadline: remaining === 0 ? null : current.deadline, complete: remaining === 0 };
    });
    const interval = window.setInterval(tick, 200);
    document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', tick); };
  }, [timer.deadline]);

  const minuteDisplay = Math.floor(timer.remaining / 60).toString().padStart(2, '0');
  const secondDisplay = (timer.remaining % 60).toString().padStart(2, '0');
  const progress = timer.remaining / timer.duration;
  function toggle() {
    setTimer((current) => {
      if (current.deadline !== null) { const remaining = Math.max(0, Math.ceil((current.deadline - Date.now()) / 1000)); return { ...current, deadline: null, remaining, complete: remaining === 0 }; }
      const remaining = current.remaining > 0 ? current.remaining : current.duration;
      return { ...current, remaining, deadline: Date.now() + remaining * 1000, complete: false };
    });
  }
  return <div className="app-root app-focus">
    <div className="app-focus-heading"><span>A MOMENT OF FOCUS</span><p aria-live="polite">{timer.complete ? 'Nicely done. Take a breath.' : 'One thing at a time.'}</p></div>
    <div className="app-focus-clock">
      <svg viewBox="0 0 200 200" aria-hidden="true"><circle className="app-timer-track" cx="100" cy="100" r="92" /><circle className="app-timer-progress" cx="100" cy="100" r="92" strokeDasharray={`${2 * Math.PI * 92}`} strokeDashoffset={`${2 * Math.PI * 92 * (1 - progress)}`} /></svg>
      <div><span className="app-time" role="timer" aria-label={`${Math.floor(timer.remaining / 60)} minutes ${timer.remaining % 60} seconds remaining`}>{minuteDisplay}<span>:</span>{secondDisplay}</span><span className="app-timer-label" aria-live="polite">{timer.complete ? 'Nicely done. Take a breath.' : running ? 'You have this.' : timer.remaining < timer.duration ? 'A pause is part of the process.' : 'A little space to do your best work.'}</span></div>
    </div>
    <div className="app-focus-presets" aria-label="Session duration">{[5, 15, 25, 50].map((minutes) => <button key={minutes} disabled={running} aria-pressed={timer.duration === minutes * 60} className={timer.duration === minutes * 60 ? 'app-selected' : ''} onClick={() => setTimer({ duration: minutes * 60, remaining: minutes * 60, deadline: null, complete: false })}>{minutes} min</button>)}</div>
    <div className="app-focus-controls"><button className="app-primary-button app-focus-start" onClick={toggle}>{running ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}{running ? 'Pause session' : timer.complete ? 'Start again' : timer.remaining < timer.duration ? 'Resume session' : 'Start session'}</button><button className="app-icon-button" aria-label="Reset timer" title="Reset timer" onClick={() => setTimer((current) => ({ ...current, remaining: current.duration, deadline: null, complete: false }))}><RotateCcw size={17} /></button></div>
    {storageError && <p className="app-error" role="status">Timer works here, but this browser cannot save it between visits.</p>}
  </div>;
}

function CalculatorApp() {
  const [expression, setExpression] = useState('');
  const [lastCalculation, setLastCalculation] = useState('');
  const [error, setError] = useState('');
  const [evaluated, setEvaluated] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  function append(value: string) {
    setError('');
    setExpression((current) => {
      const shouldReplace = evaluated && /^[\d.(]$/.test(value);
      return (shouldReplace ? value : current + value).slice(0, 500);
    });
    setEvaluated(false);
  }
  function evaluate() {
    if (!expression.trim()) return;
    try { const result = calculate(expression); setLastCalculation(`${expression} =`); setExpression(String(result)); setEvaluated(true); setError(''); }
    catch (failure) { setError(errorText(failure)); }
  }
  function clear() { setExpression(''); setError(''); setLastCalculation(''); setEvaluated(false); }
  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); clear(); return; }
    if (event.key === 'Enter' || event.key === '=') { event.preventDefault(); evaluate(); return; }
    if (event.target === input.current || event.metaKey || event.ctrlKey || event.altKey) return;
    if (/^[\d.+\-*/()]$/.test(event.key)) { event.preventDefault(); append(event.key); }
    if (event.key === 'Backspace') { event.preventDefault(); setExpression((current) => current.slice(0, -1)); setError(''); setEvaluated(false); }
  }
  const buttons = ['(', ')', '⌫', '÷', '7', '8', '9', '×', '4', '5', '6', '−', '1', '2', '3', '+', 'AC', '0', '.', '='];
  return <div className="app-root app-calculator" onKeyDown={keyboard}>
    <div className="app-calculator-display"><span className="app-calculation-history">{lastCalculation || 'A little clarity in the numbers.'}</span><input ref={input} value={expression} onChange={(event) => { setExpression(event.target.value.slice(0, 500)); setError(''); setEvaluated(false); }} placeholder="0" aria-label="Calculation" autoComplete="off" spellCheck={false} inputMode="text" /><span className={`app-calculator-hint${error ? ' app-calculator-error' : ''}`} role="status">{error || 'Use your keyboard, too.'}</span></div>
    <div className="app-calculator-grid">{buttons.map((button) => <button key={button} className={`${['÷', '×', '−', '+'].includes(button) ? 'app-operation' : ''}${button === '=' ? ' app-equals' : ''}${['(', ')', '⌫', 'AC'].includes(button) ? ' app-utility' : ''}`} aria-label={button === '⌫' ? 'Backspace' : button === 'AC' ? 'Clear calculation' : button === '=' ? 'Equals' : button === '÷' ? 'Divide' : button === '×' ? 'Multiply' : button === '−' ? 'Subtract' : button === '+' ? 'Add' : button === '(' ? 'Open parenthesis' : button === ')' ? 'Close parenthesis' : button} onClick={() => {
      if (button === '=') evaluate();
      else if (button === 'AC') clear();
      else if (button === '⌫') { setExpression((current) => current.slice(0, -1)); setError(''); setEvaluated(false); }
      else append(button);
    }}>{button}</button>)}</div>
  </div>;
}

export function WorkspaceApp({ type }: { type: BuiltinAppType }) {
  if (type === 'notes') return <NotesApp />;
  if (type === 'files') return <FilesApp />;
  if (type === 'focus') return <FocusApp />;
  return <CalculatorApp />;
}
