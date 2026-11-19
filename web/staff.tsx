import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Bell, Check, ChefHat, CreditCard, DoorOpen, LayoutGrid, LogOut, Plus, ReceiptText, Settings } from 'lucide-react';
import { callReasonLabel, roleLabel, type Category, type Employee, type Line, type Order, type Receipt, type Role, type Table } from '../shared/model';
import { api, ApiError, requestId, useLive } from './api';
import { Manager } from './manager';
import { KitchenBoard } from './kitchen-board';
import type { Ticket } from '../shared/kitchen';
import { TransferVisit } from './transfer-visit';
import { FloorOverview } from './floor-overview';
import { Manual } from './manual-order';
import { useNow, elapsedLabel } from './service-alerts';
import { clock, Dialog, Feedback, Mark, message, money, Status, tableNumber } from './ui';

type StaffIdentity = Pick<Employee, 'id' | 'name' | 'roles' | 'canFiscalize'> & { restaurant: { name: string; slug: string }; demo: boolean };
type FloorState = { tables: Table[]; categories: Category[] };
export type Command = <T = unknown>(path: string, body?: unknown, station?: string) => Promise<T>;
const roleIcons = { WAITER: LayoutGrid, KITCHEN: ChefHat, MANAGER: Settings };
const roles = ['WAITER', 'KITCHEN', 'MANAGER'] as const;
const query = new URLSearchParams(location.search);
const pinned = roles.find(role => role === query.get('mode'));
const staffKey = `restaurant:staff:${pinned ?? 'all'}`;

export function StaffApp() {
  const [secret, setSecret] = useState(() => localStorage.getItem(staffKey) || '');
  const [identity, setIdentity] = useState<StaffIdentity>();
  const [mode, setMode] = useState<Role>(pinned ?? 'WAITER');
  const [version, setVersion] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function install(profile: StaffIdentity, access: string) {
    if (pinned && !profile.roles.includes(pinned)) throw new Error(`To urządzenie wymaga uprawnień do trybu ${roleLabel[pinned]}.`);
    setIdentity(profile);
    setSecret(access);
    localStorage.setItem(staffKey, access);
    setMode(old => pinned ?? (profile.roles.includes(old) ? old : profile.roles[0]));
  }

  function forget() { localStorage.removeItem(staffKey); setSecret(''); setIdentity(undefined); }

  useEffect(() => {
    if (!secret) return;
    let active = true;
    api<StaffIdentity>('/staff/me', { secret }).then(profile => { if (active) install(profile, secret); }).catch(error => {
      if (!active) return;
      if (!(error instanceof ApiError) || error.status === 401) forget();
      setError(message(error));
    });
    return () => { active = false; };
  }, [secret, version]);

  const online = useLive('staff', secret, '', () => setVersion(value => value + 1));

  const command: Command = async (path, body, station) => {
    try {
      const result = await api(path, { secret, body, station });
      if (body !== undefined) setVersion(value => value + 1);
      return result as never;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) forget();
      throw error;
    }
  };

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError('');
    const body = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const result = await api<{ secret: string; employee: StaffIdentity }>('/staff/login', { body });
      install(result.employee, result.secret);
    } catch (error) { setError(message(error)); }
    finally { setBusy(false); }
  }

  async function logout() {
    setError('');
    try { await command('/staff/logout', {}); forget(); }
    catch (error) { setError(message(error)); }
  }

  if (!identity) return <main className="login-page"><div className="panel login-panel"><Mark /><span className="eyebrow">RESTAURANTOS · OBSŁUGA</span><h1>{pinned ? `Tryb ${roleLabel[pinned]}` : 'Zaloguj się do lokalu'}</h1>
    <form className="stack" onSubmit={login}><label>Lokal<input name="slug" autoComplete="organization" defaultValue={query.get('venue') ?? ''} required /></label>
      <label>Login<input name="user" autoComplete="username" required /></label><label>Hasło<input name="password" type="password" autoComplete="current-password" required /></label>
      <Feedback text={error} /><button className="button primary" disabled={busy}>Zaloguj się</button></form></div></main>;

  return <div className="staff-page"><header className="staff-header"><div className="brand"><Mark /><span>{identity.restaurant.name}<small>RESTAURANTOS</small></span></div>
    <nav className="staff-nav" aria-label="Tryby aplikacji">{(pinned ? [pinned] : identity.roles).map(role => { const Icon = roleIcons[role]; return <button key={role} className={mode === role ? 'selected' : ''} aria-pressed={mode === role} onClick={() => setMode(role)}><Icon size={17} />{roleLabel[role]}</button>; })}</nav>
    <div className="staff-account"><span className={`connection ${online ? 'online' : ''}`}><i />{online ? 'Na żywo' : 'Łączenie'}</span><span className="staff-name">{identity.name}</span><button className="icon-button" aria-label="Wyloguj się" onClick={() => void logout()}><LogOut size={19} /></button></div></header>
    <main className="staff-main"><Feedback text={error} />{mode === 'WAITER' && <Floor scope={identity.restaurant.slug} version={version} command={command} canFiscalize={identity.canFiscalize} demo={identity.demo} />}
      {mode === 'KITCHEN' && <Kitchen key={identity.restaurant.slug} venue={identity.restaurant.slug} version={version} command={command} />}
      {mode === 'MANAGER' && <Manager version={version} command={command} />}
    </main></div>;
}

function useStaffData<T>(command: Command, path: string, version: number) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState('');
  const commandRef = useRef(command);
  commandRef.current = command;
  useEffect(() => {
    let active = true;
    commandRef.current<T>(path).then(value => { if (active) { setData(value); setError(''); } }).catch(error => { if (active) setError(message(error)); });
    return () => { active = false; };
  }, [path, version]);
  return { data, error };
}

function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); } catch (error) { setError(message(error)); } finally { setBusy(false); }
  }
  return { busy, error, setError, run };
}

function heading(eyebrow: string, title: string, description: string) {
  return <div className="staff-title"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>;
}

function Floor({ command, version, canFiscalize, demo, scope }: { command: Command; version: number; canFiscalize: boolean; demo: boolean; scope: string }) {
  const { data, error } = useStaffData<FloorState>(command, '/staff/floor', version);
  const [selected, setSelected] = useState('');
  const table = data?.tables.find(table => table.id === selected);
  const tables = data?.tables ?? [];
  return <>{heading('TRYB KELNER', 'Mapa sali', 'Wybierz stolik, aby zobaczyć zamówienia, wezwania i rachunek.')}
    <Feedback text={error} /><FloorOverview tables={data?.tables} scope={scope} onSelect={setSelected} />
    {table && <TableDetails key={`${table.id}:${table.visit?.id ?? ''}`} table={table} tables={tables} categories={data?.categories ?? []} command={command} demo={demo} canFiscalize={canFiscalize} selectTable={setSelected} close={() => setSelected('')} />}
  </>;
}

function TableDetails({ table, tables, categories, command, demo, canFiscalize, close, selectTable }: { table: Table; tables: Table[]; categories: Category[]; command: Command; demo: boolean; canFiscalize: boolean; close: () => void; selectTable: (id: string) => void }) {
  const { busy, error, run } = useAction();
  const [manual, setManual] = useState(false);
  const [reason, setReason] = useState<{ id: string; key?: string }>();
  const [correction, setCorrection] = useState<{ orderId: string; line: Line }>();
  const [checkout, setCheckout] = useState(false);
  const [discard, setDiscard] = useState<{ visitId: string; snapshot: Pick<Line, 'key' | 'quantity' | 'price'>[] }>();
  const visit = table.visit;
  const receipt = visit?.receipts.find(receipt => receipt.status !== 'FAILED');
  const send = (path: string, body: unknown = {}) => command(`/staff${path}`, path.startsWith('/tables/') && visit ? { visitId: visit.id, ...(body as object) } : body);
  const call = visit?.calls.find(call => !call.resolvedAt);
  const now = useNow();

  return <Dialog title={`Stolik ${tableNumber(table.number)}`} close={close}>
    <Feedback text={error} />
    {!visit ? <div className="stack"><p>Goście mogą sami rozpocząć wizytę przez kod QR. Otwórz stolik tutaj, jeśli przyjmujesz zamówienie ustnie.</p><button className="button primary" disabled={busy} onClick={() => void run(() => send(`/tables/${table.id}/open`))}><DoorOpen size={18} /> Otwórz stolik</button></div> : <div className="stack">
      <div className="table-session"><div><span className="eyebrow">PIN GOŚCI</span><strong>{visit.pin ? `${visit.pin.slice(0, 3)} ${visit.pin.slice(3)}` : 'Jeszcze nieustawiony'}</strong></div><div><span className="eyebrow">DO ROZLICZENIA</span><strong>{money(visit.total)}</strong></div></div>
      {call && <div className="notice-row"><Bell size={20} /><span>{callReasonLabel[call.reason] ?? callReasonLabel.HELP} · {clock(call.createdAt)} · czeka {elapsedLabel(call.createdAt, now)}</span><button className="button quiet" disabled={busy} onClick={() => void run(() => send(`/calls/${call.id}/resolve`))}>Obsłużone</button></div>}
      <div className="row-actions"><button className="button primary" disabled={!!receipt} onClick={() => setManual(true)}><Plus size={17} /> Dodaj zamówienie</button>
        {canFiscalize && <button className="button quiet" onClick={() => setCheckout(true)}><ReceiptText size={17} /> Rozlicz stolik</button>}
        {!receipt && <TransferVisit table={table} visitId={visit.id} tables={tables} command={command} selectTable={selectTable} />}
        {!visit.cart.length && visit.orders.every(order => ['REJECTED', 'CANCELED'].includes(order.status)) && !receipt && <button className="button quiet" disabled={busy} onClick={() => void run(() => send(`/tables/${table.id}/close-empty`))}>Zamknij pusty stolik</button>}</div>
      {!!visit.cart.length && <div className="order-line"><span>W koszyku gości: {visit.cart.reduce((sum, line) => sum + line.quantity, 0)} szt. przed wysłaniem.</span>
        {!receipt && <button className="text-button" onClick={() => setDiscard({ visitId: visit.id, snapshot: visit.cart.map(({ key, quantity, price }) => ({ key, quantity, price })) })}>Opróżnij koszyk</button>}</div>}
      {visit.orders.length ? [...visit.orders].reverse().map(order => <article className="order-card" key={order.id}>
        <div className="order-head"><Status status={order.status} /><small>{order.source === 'QR' ? 'Telefon' : 'Kelner'} · {clock(order.createdAt)}{order.status === 'PENDING' && ' · czeka ' + elapsedLabel(order.createdAt, now)}</small></div>
        {order.reason && <Feedback text={order.reason} />}
        {order.lines.map(line => <div className={`order-line ${line.canceled ? 'canceled' : ''}`} key={line.key}>
          <div><strong>{line.quantity} × {line.name}</strong><small>{line.readyAt && !line.canceled && ['ACCEPTED', 'PREPARING', 'READY'].includes(order.status) && <b className="ready-line-label">Do podania · </b>}{[line.option, line.note, line.canceled && `Anulowano: ${line.canceled}`].filter(Boolean).join(' · ')}</small></div>
          <div className="line-actions"><b>{money(line.price * line.quantity)}</b>
            {!receipt && !line.canceled && !line.readyAt && ['ACCEPTED', 'PREPARING'].includes(order.status) &&
              <button className="text-button" onClick={() => setCorrection({ orderId: order.id, line })}>Zmień pozycję</button>}
            {!line.canceled && !receipt && ['ACCEPTED', 'PREPARING', 'READY', 'SERVED'].includes(order.status) && <button className="text-button" onClick={() => setReason({ id: order.id, key: line.key })}>Anuluj pozycję</button>}</div>
        </div>)}
        {order.status === 'PENDING' && <div className="row-actions"><button className="button primary" disabled={busy} onClick={() => void run(() => send(`/orders/${order.id}`, { action: 'ACCEPT' }))}><Check size={17} /> Akceptuj</button><button className="button quiet" onClick={() => setReason({ id: order.id })}>Odrzuć</button></div>}
        {order.status === 'READY' && <button className="button quiet" disabled={busy} onClick={() => void run(() => send(`/orders/${order.id}`, { action: 'SERVE' }))}>Oznacz jako podane</button>}
      </article>) : <p className="empty-card">Przy tym stoliku nie złożono jeszcze zamówienia.</p>}
    </div>}
    {manual && <Manual categories={categories} close={() => setManual(false)} submit={body => send(`/tables/${table.id}/manual`, body)} />}
    {reason && <Reason title={reason.key === undefined ? 'Odrzuć zamówienie' : 'Anuluj pozycję'} close={() => setReason(undefined)} submit={text => send(`/orders/${reason.id}`, { action: reason.key === undefined ? 'REJECT' : 'CANCEL_LINE', key: reason.key, reason: text })} />}
    {correction && <LineCorrection line={correction.line} close={() => setCorrection(undefined)} submit={body => send(`/orders/${correction.orderId}`, body)} />}
    {checkout && visit && <Checkout table={table} receipt={receipt} command={command} demo={demo} close={() => setCheckout(false)} />}
    {discard && <Dialog title="Opróżnić koszyk gości?" close={() => setDiscard(undefined)}><div className="stack">
      <p>Usuniesz pozycje, których goście jeszcze nie wysłali do obsługi.</p><Feedback text={error} />
      <button className="button primary" disabled={busy} onClick={() => void run(async () => { await send(`/tables/${table.id}/discard-cart`, discard); setDiscard(undefined); })}>Opróżnij koszyk</button>
    </div></Dialog>}
  </Dialog>;
}

function LineCorrection({ line, close, submit }: { line: Line; close: () => void; submit: (body: unknown) => Promise<unknown> }) {
  const { busy, error, run } = useAction();
  const request = useRef(requestId());
  return <Dialog title={`Zmień pozycję · ${line.name}`} close={() => { if (!busy) close(); }}>
    <form className="stack" onChange={() => { request.current = requestId(); }} onSubmit={event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      void run(async () => {
        await submit({ action: 'CHANGE_LINE', key: line.key, request: request.current, previousQuantity: line.quantity, previousNote: line.note,
          quantity: Number(form.get('quantity')), note: form.get('note'), reason: form.get('reason') });
        close();
      });
    }}>
      <label>Ilość<input type="number" name="quantity" defaultValue={line.quantity} min={1} max={99} required /></label>
      <label>Uwagi dla stanowiska<input name="note" defaultValue={line.note} maxLength={300} /></label>
      <label>Powód zmiany<textarea name="reason" maxLength={300} required /></label>
      <Feedback text={error} /><button className="button primary" disabled={busy}>Zapisz zmianę</button>
    </form>
  </Dialog>;
}

function Reason({ title, close, submit }: { title: string; close: () => void; submit: (reason: string) => Promise<unknown> }) {
  const { busy, error, run } = useAction();
  return <Dialog title={title} close={close}><form className="stack" onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void run(async () => { await submit(String(form.get('reason'))); close(); }); }}>
    <label>Powód<textarea name="reason" autoFocus required maxLength={300} /></label><Feedback text={error} /><button className="button primary" disabled={busy}>Potwierdź</button></form></Dialog>;
}

function Checkout({ table, receipt, command, demo, close }: { table: Table; receipt?: Receipt; command: Command; demo: boolean; close: () => void }) {
  const { busy, error, run } = useAction();
  const [method, setMethod] = useState<'CASH' | 'CARD'>('CASH');
  const station = 'local-demo';
  async function print() {
    const prepared = await command<Receipt>(`/fiscal/tables/${table.id}/prepare`, { method, visitId: table.visit?.id }, station);
    if (prepared.status !== 'PREPARED') return;
    await command(`/fiscal/${prepared.id}/claim`, {}, station);
    await command(`/fiscal/${prepared.id}/result`, { status: 'ISSUED', reference: `DEMO-${prepared.id.slice(0, 8).toUpperCase()}` }, station);
  }
  const needsCheck = receipt && ['UNKNOWN', 'SENDING'].includes(receipt.status);
  return <Dialog title={`Rozliczenie · stolik ${tableNumber(table.number)}`} close={close}><div className="stack">
    <div className="cart-total"><span>Do rozliczenia</span><strong>{money(receipt?.total ?? table.visit?.total ?? 0)}</strong></div>
    {demo ? <Feedback text="Tryb demonstracyjny. Wydruk jest symulowany." alert={false} /> : <Feedback text="Drukarka fiskalna oczekuje na integrację z wybranym modelem." />}
    {!receipt && <label>Metoda płatności<select value={method} onChange={event => setMethod(event.target.value as typeof method)}><option value="CASH">Gotówka</option><option value="CARD">Karta · osobny terminal</option></select></label>}
    {needsCheck && <Feedback text="Wynik wydruku wymaga sprawdzenia przez managera. Ponowny wydruk jest zablokowany." />}
    {receipt?.status === 'ISSUED' && <Feedback text={`Wydano paragon ${receipt.reference}. Potwierdź po przyjęciu zapłaty.`} alert={false} />}
    <Feedback text={error} />
    {(!receipt || receipt.status === 'PREPARED') && <button className="button primary" disabled={busy || !demo} onClick={() => void run(print)}><ReceiptText size={18} /> Wystaw paragon</button>}
    {receipt?.status === 'ISSUED' && <button className="button primary" disabled={busy || !demo} onClick={() => void run(async () => { await command(`/fiscal/${receipt.id}/settle`, {}, station); close(); })}><CreditCard size={18} /> Zapłacono · zamknij stolik</button>}
  </div></Dialog>;
}

function Kitchen({ version, command, venue }: { version: number; command: Command; venue: string }) {
  const { data, error: loadError } = useStaffData<Ticket[]>(command, '/staff/kitchen', version);
  const { busy, error, run } = useAction();
  return <>{heading('TRYB KUCHNIA', 'Kolejka zamówień', 'Przyjęte zamówienia z sali i telefonów gości.')}
    <Feedback text={loadError || error} />
    <KitchenBoard data={data} venue={venue} busy={busy} send={(id, action) => void run(() => command(`/staff/orders/${id}`, action))} />
  </>;
}
