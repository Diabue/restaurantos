import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ClipboardList, LayoutGrid, Plus, QrCode, Settings, Users, Utensils } from 'lucide-react';
import QRCode from 'qrcode';
import { roleLabel, stationLabel, type Category, type Employee, type Product, type Restaurant, type Table, type TableTransfer, type Visit } from '../shared/model';
import { requestId } from './api';
import { ProductPhoto } from './product-photo';
import { FloorPlan } from './floor-plan';
import type { Command } from './staff';
import { tableMenuPath } from './table-menu';
import { Dialog, Feedback, message, money, Status, tableNumber } from './ui';

type History = Omit<Visit, 'pin'> & { table: { number: number }; openedAt: string; closedAt?: string; transfers?: TableTransfer[] };
type Model = { restaurant: Restaurant; categories: Category[]; tables: Table[]; employees: Employee[]; history: History[] };
type Editor = { kind: 'restaurant' } | { kind: 'category'; value?: Category } | { kind: 'product'; value?: Product } |
  { kind: 'table'; value?: Table } | { kind: 'employee'; value?: Employee } | { kind: 'qr'; value: Table };
const pages = [{ label: 'Menu', icon: Utensils }, { label: 'Stoliki', icon: LayoutGrid }, { label: 'Personel', icon: Users }, { label: 'Historia', icon: ClipboardList }, { label: 'Lokal', icon: Settings }];
const dateTime = (value: string) => new Date(value).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' });

export function Manager({ version, command }: { version: number; command: Command }) {
  const [data, setData] = useState<Model>();
  const [error, setError] = useState('');
  const [page, setPage] = useState('Menu');
  const [editor, setEditor] = useState<Editor>();
  const commandRef = useRef(command);
  commandRef.current = command;
  useEffect(() => {
    let active = true;
    commandRef.current<Model>('/manager').then(value => { if (active) { setData(value); setError(''); } }).catch(error => { if (active) setError(message(error)); });
    return () => { active = false; };
  }, [version]);

  return <><div className="staff-title"><span className="eyebrow">TRYB MANAGER</span><h1>Zarządzanie lokalem</h1><p>Skonfiguruj menu, salę i dostęp do aplikacji.</p></div>
    <div className="segmented manager-tabs">{pages.map(({ label, icon: Icon }) => <button className={page === label ? 'selected' : ''} key={label} onClick={() => setPage(label)}><Icon size={16} />{label}</button>)}</div>
    <Feedback text={error} />{!data && <p className="empty-card">Ładowanie konfiguracji…</p>}
    {data && page === 'Menu' && <div className="stack">
      <div className="row-actions"><button className="button primary" onClick={() => setEditor({ kind: 'category' })}><Plus size={17} /> Kategoria</button>
        <button className="button quiet" disabled={!data.categories.length} onClick={() => setEditor({ kind: 'product' })}><Plus size={17} /> Danie</button></div>
      {data.categories.map(category => <section className="panel manager-panel" key={category.id}><div className="order-head"><h2>{category.name}</h2><button className="text-button" onClick={() => setEditor({ kind: 'category', value: category })}>Edytuj kategorię</button></div>
        {category.products.map(product => <div className="manager-row" key={product.id}><div><strong>{product.name}</strong><small>{money(product.price)} · {stationLabel[product.station ?? 'KITCHEN']} · {product.available ? 'Dostępne' : 'Ukryte w menu'}</small></div><button className="button quiet" onClick={() => setEditor({ kind: 'product', value: product })}>Edytuj</button></div>)}</section>)}
    </div>}
    {data && <div hidden={page !== 'Stoliki'}><div className="stack">
      <FloorPlan tables={data.tables} command={command} editTable={value => setEditor({ kind: 'table', value })} onSaved={moves => setData(current => current && ({
        ...current, tables: current.tables.map(table => ({ ...table, ...moves.find(move => move.id === table.id) })),
      }))} />
      <section className="panel manager-panel"><h2>Menu i kody QR stolików</h2>{data.tables.map(table => <div className="manager-row" key={table.id}>
        <strong>Stolik {tableNumber(table.number)}</strong><div className="row-actions">
          <a className="button quiet" href={tableMenuPath(table.code)} target="_blank" rel="noreferrer" aria-label={`Otwórz menu stolika ${tableNumber(table.number)}`}>Otwórz menu</a>
          <button className="button quiet" onClick={() => setEditor({ kind: 'qr', value: table })}><QrCode size={17} /> Pokaż QR</button>
        </div></div>)}</section>
    </div></div>}
    {data && page === 'Personel' && <div className="stack"><div className="row-actions"><button className="button primary" onClick={() => setEditor({ kind: 'employee' })}><Plus size={17} /> Pracownik</button></div>
      <section className="panel manager-panel"><h2>Konta i uprawnienia</h2>{data.employees.map(employee => <div className="manager-row" key={employee.id}>
        <div><strong>{employee.name} · {employee.username}</strong><small>{employee.roles.map(role => roleLabel[role]).join(', ')}{employee.canFiscalize && ' · Fiskalizacja'}{!employee.active && ' · Nieaktywne'}</small></div>
        <button className="button quiet" onClick={() => setEditor({ kind: 'employee', value: employee })}>Edytuj</button></div>)}</section>
    </div>}
    {data && page === 'Historia' && <section className="panel manager-panel"><h2>Wizyty i rozliczenia</h2>{!data.history.length && <p className="empty-card">Brak wizyt.</p>}
      {data.history.map(visit => <details className="history-item" key={visit.id}><summary><strong>Stolik {tableNumber(visit.table.number)}</strong><span>{dateTime(visit.openedAt)} · {visit.closedAt ? 'Zamknięty' : 'Otwarty'}</span><b>{money(visit.total)}</b></summary>
        <div className="stack">{visit.transfers?.map(move => <div className="order-card" key={move.request}>
          <strong>Przeniesienie ze stolika {tableNumber(move.fromNumber)} na {tableNumber(move.toNumber)}</strong>
          <p>{dateTime(move.at)} · {move.employeeName}</p></div>)}
          {visit.orders.map(order => <div className="order-card" key={order.id}><Status status={order.status} />{order.reason && <p>{order.reason}</p>}
          {order.lines.map(line => <div className="order-line" key={line.key}><span>{line.quantity} × {line.name}{line.canceled && ` · Anulowano: ${line.canceled}`}</span></div>)}</div>)}
          {visit.receipts.map(receipt => <div className="order-card" key={receipt.id}><strong>Rozliczenie · {money(receipt.total)} · {receipt.method === 'CARD' ? 'Karta' : 'Gotówka'}</strong>
            <p>{({ PREPARED: 'Przygotowane', SENDING: 'Wysyłanie lub nieznany wynik', UNKNOWN: 'Wymaga weryfikacji', ISSUED: 'Wydano paragon', FAILED: 'Wydruk nieudany' })[receipt.status]}{receipt.reference && ` · ${receipt.reference}`}</p>
            {['SENDING', 'UNKNOWN'].includes(receipt.status) && <ReceiptResolution id={receipt.id} command={command} />}</div>)}
        </div></details>)}</section>}
    {data && page === 'Lokal' && <section className="panel manager-panel"><div className="order-head"><h2>{data.restaurant.name}</h2><button className="button quiet" onClick={() => setEditor({ kind: 'restaurant' })}>Edytuj dane</button></div><p>{data.restaurant.tagline || 'Dodaj krótki opis lokalu.'}</p>{data.restaurant.image && <img className="venue-preview" src={data.restaurant.image} alt="Okładka menu" />}</section>}
    {editor && data && (editor.kind === 'qr' ? <Qr table={editor.value} close={() => setEditor(undefined)} /> : <Edit editor={editor} data={data} command={command} close={() => setEditor(undefined)} />)}
  </>;
}

function ReceiptResolution({ id, command }: { id: string; command: Command }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    try { await command(`/fiscal/${id}/resolve`, Object.fromEntries(new FormData(event.currentTarget))); }
    catch (error) { setError(message(error)); } finally { setBusy(false); }
  }
  return <form className="stack" onSubmit={submit}><p>Sprawdź zapis na urządzeniu fiskalnym przed ustaleniem wyniku.</p><label>Wynik<select name="status" required><option value="ISSUED">Paragon został wydany</option><option value="FAILED">Urządzenie potwierdza brak paragonu</option></select></label>
    <label>Numer paragonu lub opis weryfikacji<input name="reference" required maxLength={300} /></label><Feedback text={error} /><button className="button quiet" disabled={busy}>Zapisz wynik</button></form>;
}

function Qr({ table, close }: { table: Table; close: () => void }) {
  const [base, setBase] = useState(() => localStorage.getItem('restaurant:guestOrigin') || location.origin);
  const [image, setImage] = useState('');
  const [url, setUrl] = useState('');
  useEffect(() => {
    let active = true;
    setImage(''); setUrl('');
    try {
      const origin = new URL(base);
      if (!['http:', 'https:'].includes(origin.protocol)) return;
      const url = new URL(tableMenuPath(table.code), origin).href;
      QRCode.toDataURL(url, { width: 480, margin: 3 }).then(src => {
        if (active) { setImage(src); setUrl(url); localStorage.setItem('restaurant:guestOrigin', origin.origin); }
      }).catch(() => {});
    } catch { /* Entering an incomplete URL. */ }
    return () => { active = false; };
  }, [base, table.code]);
  return <Dialog title={`QR · stolik ${tableNumber(table.number)}`} close={close}><div className="stack qr-content">
    <label>Adres serwera<input type="url" value={base} onChange={event => setBase(event.target.value)} /></label>
    {image ? <><label>Pełny link do stolika {tableNumber(table.number)}<input type="url" value={url} readOnly onFocus={event => event.currentTarget.select()} /></label>
      <img src={image} alt={`Kod QR dla stolika ${tableNumber(table.number)}`} /><a href={url} target="_blank" rel="noreferrer">Otwórz menu stolika</a><a className="button primary" href={image} download={`stolik-${table.number}.png`}>Pobierz kod QR</a></> : <p>Podaj poprawny adres HTTP lub HTTPS.</p>}</div></Dialog>;
}

function Edit({ editor, data, command, close }: { editor: Exclude<Editor, { kind: 'qr' }>; data: Model; command: Command; close: () => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [point, setPoint] = useState(() => editor.kind === 'table' ? { x: editor.value?.x ?? 50, y: editor.value?.y ?? 50 } : { x: 50, y: 50 });
  let fields: ReactNode;
  let title: string;
  let encode: (form: FormData) => unknown;
  if (editor.kind === 'restaurant') {
    title = 'Dane lokalu';
    const value = data.restaurant;
    fields = <><Field name="name" label="Nazwa" value={value.name} required /><Field name="tagline" label="Krótki opis" value={value.tagline} /><Field name="image" label="Adres zdjęcia w tle" value={value.image} /><Field name="logo" label="Adres logo" value={value.logo} />
      <label>Alarm po czasie oczekiwania (min)<input name="kitchenAlertMinutes" type="number" min={1} max={240} defaultValue={value.kitchenAlertMinutes ?? 15} required /></label></>;
    encode = form => ({ ...Object.fromEntries(form), kitchenAlertMinutes: Number(form.get('kitchenAlertMinutes')) });
  } else if (editor.kind === 'category') {
    title = 'Kategoria menu';
    fields = <><Field name="name" label="Nazwa" value={editor.value?.name} required /><Field name="position" label="Kolejność" type="number" value={editor.value?.position ?? data.categories.length} required /></>;
    encode = form => ({ id: editor.value?.id, name: form.get('name'), position: Number(form.get('position')) });
  } else if (editor.kind === 'product') {
    title = 'Danie';
    const value = editor.value;
    fields = <><Field name="name" label="Nazwa" value={value?.name} required /><label>Kategoria<select name="categoryId" defaultValue={value?.categoryId} required>{data.categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
      <label>Stanowisko przygotowania<select name="station" defaultValue={value?.station ?? 'KITCHEN'}>
        {Object.entries(stationLabel).map(([station, label]) => <option key={station} value={station}>{label}</option>)}</select></label>
      <Field name="description" label="Opis" value={value?.description} /><ProductPhoto image={value?.image} />
      <div className="form-grid"><Field name="price" label="Cena (zł)" type="number" value={value ? value.price / 100 : undefined} step="0.01" required /><Field name="fiscalCode" label="Kod fiskalny" value={value?.fiscalCode} required />
        <label>Grupa VAT drukarki<select name="vatCode" defaultValue={value?.vatCode} required>{'ABCDEFG'.split('').map(code => <option key={code}>{code}</option>)}</select></label></div>
      <label>Opcje · jedna w wierszu w formacie „Nazwa | dopłata w zł”<textarea name="options" defaultValue={value?.options.map(option => `${option.name} | ${option.extra / 100}`).join('\n')} placeholder="500 ml | 5" /></label>
      <label className="checkbox"><input type="checkbox" name="available" defaultChecked={value?.available ?? true} /> Widoczne i dostępne w menu</label></>;
    encode = form => {
      const { options, available, price, photo, ...values } = Object.fromEntries(form);
      const parsed = String(options).split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
        const parts = line.split('|');
        const name = parts[0].trim();
        const extra = Number(parts[1]?.trim().replace(',', '.'));
        if (parts.length !== 2 || !name || !parts[1].trim() || !Number.isFinite(extra) || extra < 0) throw new Error('Podaj opcje w formacie „Nazwa | dopłata”, np. „500 ml | 5”.');
        return { name, extra: Math.round(extra * 100), id: value?.options.find(option => option.name === name)?.id ?? requestId() };
      });
      const product = { ...values, id: value?.id, price: Math.round(Number(price) * 100), available: available === 'on', options: parsed };
      if (!(photo instanceof File) || !photo.name) return product;
      const upload = new FormData();
      upload.append('product', JSON.stringify(product));
      upload.append('photo', photo);
      return upload;
    };
  } else if (editor.kind === 'table') {
    title = 'Stolik na planie';
    fields = <><div className="form-grid"><Field name="number" label="Numer" type="number" value={editor.value?.number ?? Math.max(0, ...data.tables.map(table => table.number)) + 1} required /><Field name="seats" label="Miejsca" type="number" value={editor.value?.seats ?? 4} required /></div>
      {!editor.value && <>
      <p>Dotknij planu, aby ustawić stolik, lub wpisz pozycję w procentach.</p>
      <div className="floor-map picker" onPointerDown={event => { const rect = event.currentTarget.getBoundingClientRect(); setPoint({ x: Math.round(Math.min(93, Math.max(7, (event.clientX - rect.left) / rect.width * 100))), y: Math.round(Math.min(88, Math.max(12, (event.clientY - rect.top) / rect.height * 100))) }); }}>
        {data.tables.filter(table => table.id !== editor.value?.id).map(table => <span className="table-tile" key={table.id} style={{ left: `${table.x}%`, top: `${table.y}%` }}>{tableNumber(table.number)}</span>)}<span className="table-tile table-active" style={{ left: `${point.x}%`, top: `${point.y}%` }}>●</span>
      </div><div className="form-grid"><label>Poziomo (%)<input type="number" value={point.x} min={7} max={93} onChange={event => setPoint(old => ({ ...old, x: Number(event.target.value) }))} required /></label>
        <label>Pionowo (%)<input type="number" value={point.y} min={12} max={88} onChange={event => setPoint(old => ({ ...old, y: Number(event.target.value) }))} required /></label></div></>}</>;
    encode = form => ({ id: editor.value?.id, number: Number(form.get('number')), seats: Number(form.get('seats')), ...(editor.value ? {} : point) });
  } else {
    title = 'Konto pracownika';
    fields = <><Field name="name" label="Imię lub nazwa" value={editor.value?.name} required /><Field name="username" label="Login" value={editor.value?.username} required />
      <label>{editor.value ? 'Nowe hasło (opcjonalne)' : 'Hasło'}<input type="password" name="password" minLength={8} maxLength={128} required={!editor.value} autoComplete="new-password" /></label>
      <fieldset><legend>Uprawnienia do trybów</legend>{Object.entries(roleLabel).map(([value, label]) => <label key={value} className="checkbox"><input type="checkbox" name="roles" value={value} defaultChecked={editor.value?.roles.some(role => role === value)} /> {label}</label>)}</fieldset>
      <label className="checkbox"><input type="checkbox" name="canFiscalize" defaultChecked={editor.value?.canFiscalize} /> Wystawianie paragonów</label>
      <label className="checkbox"><input type="checkbox" name="active" defaultChecked={editor.value?.active ?? true} /> Aktywne konto</label></>;
    encode = form => ({ id: editor.value?.id, name: form.get('name'), username: form.get('username'), password: form.get('password') || undefined,
      roles: form.getAll('roles'), canFiscalize: form.has('canFiscalize'), active: form.has('active') });
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    try { await command(`/manager/${editor.kind}`, encode(new FormData(event.currentTarget))); close(); }
    catch (error) { setError(message(error)); } finally { setBusy(false); }
  }
  return <Dialog title={title} close={close}><form className="stack" onSubmit={submit}>{fields}<Feedback text={error} /><button className="button primary" disabled={busy}>Zapisz</button></form></Dialog>;
}

function Field({ name, label, value, type = 'text', required, step }: { name: string; label: string; value?: string | number; type?: string; required?: boolean; step?: string }) {
  return <label>{label}<input name={name} type={type} defaultValue={value} required={required} step={step} /></label>;
}
