import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Bell, Check, ChefHat, ClipboardList, CreditCard, DoorOpen, LayoutGrid, LogOut, Plus, ReceiptText, Settings, Users } from 'lucide-react';
import { roleLabel, type Category, type Employee, type Line, type Order, type Receipt, type Role, type Table } from '../shared/model';
import { api, ApiError, requestId, useLive } from './api';
import { Manager } from './manager';
import { clock, Dialog, Feedback, Mark, message, money, Status, tableNumber } from './ui';

type StaffIdentity = Pick<Employee, 'id' | 'name' | 'roles' | 'canFiscalize'> & { restaurant: { name: string; slug: string }; demo: boolean };
type KitchenOrder = Omit<Order, 'lines'> & { table: number; lines: Pick<Line, 'key' | 'name' | 'option' | 'quantity' | 'canceled' | 'note'>[] };
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
    <main className="staff-main"><Feedback text={error} />{mode === 'WAITER' && <Floor version={version} command={command} canFiscalize={identity.canFiscalize} demo={identity.demo} />}
      {mode === 'KITCHEN' && <Kitchen version={version} command={command} />}
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

function tableState(table: Table) {
  if (table.visit?.calls.some(call => !call.resolvedAt)) return ['call', 'Wezwanie'];
  if (table.visit?.orders.some(order => order.status === 'PENDING')) return ['pending', 'Do akceptacji'];
  if (table.visit?.orders.some(order => order.status === 'READY')) return ['ready', 'Do podania'];
  return table.visit ? ['active', 'Zajęty'] : ['free', 'Wolny'];
}

function Floor({ command, version, canFiscalize, demo }: { command: Command; version: number; canFiscalize: boolean; demo: boolean }) {
  const { data, error } = useStaffData<FloorState>(command, '/staff/floor', version);
  const [selected, setSelected] = useState('');
  const table = data?.tables.find(table => table.id === selected);
  const tables = data?.tables ?? [];
  return <>{heading('TRYB KELNER', 'Mapa sali', 'Wybierz stolik, aby zobaczyć zamówienia, wezwania i rachunek.')}
    <Feedback text={error} /><div className="floor-stats">
      <div className="panel metric"><Users size={19} /><span>Otwarte stoliki</span><strong>{tables.filter(table => table.visit).length} / {tables.length}</strong></div>
      <div className="panel metric"><ClipboardList size={19} /><span>Do akceptacji</span><strong>{tables.reduce((count, table) => count + (table.visit?.orders.filter(order => order.status === 'PENDING').length ?? 0), 0)}</strong></div>
      <div className="panel metric"><Bell size={19} /><span>Wezwania</span><strong>{tables.filter(table => table.visit?.calls.some(call => !call.resolvedAt)).length}</strong></div>
    </div>
    <section className="panel floor-panel"><div className="section-heading"><div><h2>Sala główna</h2><p>{tables.length} stolików</p></div><span className="section-count">UKŁAD LOKALU</span></div>
      {tables.length ? <div className="floor-map" aria-label="Rozmieszczenie stolików">{tables.map(table => { const [color, label] = tableState(table); return <button className={`table-tile table-${color}`} key={table.id} style={{ left: `${table.x}%`, top: `${table.y}%` }} onClick={() => setSelected(table.id)}>
        <strong>{tableNumber(table.number)}</strong><small>{label}</small><span className="table-signals" aria-hidden="true">{table.visit?.calls.some(call => !call.resolvedAt) && <Bell size={13} />}{table.visit?.orders.some(order => order.status === 'PENDING') && <ClipboardList size={13} />}{table.visit?.orders.some(order => order.status === 'READY') && <Check size={13} />}</span>
      </button>; })}</div> : <p className="empty-card">{data ? 'Manager może dodać pierwszy stolik.' : 'Ładowanie sali…'}</p>}
    </section>
    {table && <TableDetails key={table.id} table={table} categories={data?.categories ?? []} command={command} demo={demo} canFiscalize={canFiscalize} close={() => setSelected('')} />}
  </>;
}

function TableDetails({ table, categories, command, demo, canFiscalize, close }: { table: Table; categories: Category[]; command: Command; demo: boolean; canFiscalize: boolean; close: () => void }) {
  const { busy, error, run } = useAction();
  const [manual, setManual] = useState(false);
  const [reason, setReason] = useState<{ id: string; key?: string }>();
  const [checkout, setCheckout] = useState(false);
  const [discard, setDiscard] = useState<{ visitId: string; snapshot: Pick<Line, 'key' | 'quantity' | 'price'>[] }>();
  const visit = table.visit;
  const receipt = visit?.receipts.find(receipt => receipt.status !== 'FAILED');
  const send = (path: string, body: unknown = {}) => command(`/staff${path}`, body);
  const call = visit?.calls.find(call => !call.resolvedAt);

  return <Dialog title={`Stolik ${tableNumber(table.number)}`} close={close}>
    <Feedback text={error} />
    {!visit ? <div className="stack"><p>Goście mogą sami rozpocząć wizytę przez kod QR. Otwórz stolik tutaj, jeśli przyjmujesz zamówienie ustnie.</p><button className="button primary" disabled={busy} onClick={() => void run(() => send(`/tables/${table.id}/open`))}><DoorOpen size={18} /> Otwórz stolik</button></div> : <div className="stack">
      <div className="table-session"><div><span className="eyebrow">PIN GOŚCI</span><strong>{visit.pin ? `${visit.pin.slice(0, 3)} ${visit.pin.slice(3)}` : 'Jeszcze nieustawiony'}</strong></div><div><span className="eyebrow">DO ROZLICZENIA</span><strong>{money(visit.total)}</strong></div></div>
      {call && <div className="notice-row"><Bell size={20} /><span>Gość wzywa obsługę · {clock(call.createdAt)}</span><button className="button quiet" disabled={busy} onClick={() => void run(() => send(`/calls/${call.id}/resolve`))}>Obsłużone</button></div>}
      <div className="row-actions"><button className="button primary" disabled={!!receipt} onClick={() => setManual(true)}><Plus size={17} /> Dodaj zamówienie</button>
        {canFiscalize && <button className="button quiet" onClick={() => setCheckout(true)}><ReceiptText size={17} /> Rozlicz stolik</button>}
        {!visit.cart.length && visit.orders.every(order => ['REJECTED', 'CANCELED'].includes(order.status)) && !receipt && <button className="button quiet" disabled={busy} onClick={() => void run(() => send(`/tables/${table.id}/close-empty`))}>Zamknij pusty stolik</button>}</div>
      {!!visit.cart.length && <div className="order-line"><span>W koszyku gości: {visit.cart.reduce((sum, line) => sum + line.quantity, 0)} szt. przed wysłaniem.</span>
        {!receipt && <button className="text-button" onClick={() => setDiscard({ visitId: visit.id, snapshot: visit.cart.map(({ key, quantity, price }) => ({ key, quantity, price })) })}>Opróżnij koszyk</button>}</div>}
      {visit.orders.length ? [...visit.orders].reverse().map(order => <article className="order-card" key={order.id}>
        <div className="order-head"><Status status={order.status} /><small>{order.source === 'QR' ? 'Telefon' : 'Kelner'} · {clock(order.createdAt)}</small></div>
        {order.reason && <Feedback text={order.reason} />}
        {order.lines.map(line => <div className={`order-line ${line.canceled ? 'canceled' : ''}`} key={line.key}>
          <div><strong>{line.quantity} × {line.name}</strong><small>{[line.option, line.note, line.canceled && `Anulowano: ${line.canceled}`].filter(Boolean).join(' · ')}</small></div>
          <div className="line-actions"><b>{money(line.price * line.quantity)}</b>{!line.canceled && !receipt && ['ACCEPTED', 'PREPARING', 'READY', 'SERVED'].includes(order.status) && <button className="text-button" onClick={() => setReason({ id: order.id, key: line.key })}>Anuluj pozycję</button>}</div>
        </div>)}
        {order.status === 'PENDING' && <div className="row-actions"><button className="button primary" disabled={busy} onClick={() => void run(() => send(`/orders/${order.id}`, { action: 'ACCEPT' }))}><Check size={17} /> Akceptuj</button><button className="button quiet" onClick={() => setReason({ id: order.id })}>Odrzuć</button></div>}
        {order.status === 'READY' && <button className="button quiet" disabled={busy} onClick={() => void run(() => send(`/orders/${order.id}`, { action: 'SERVE' }))}>Oznacz jako podane</button>}
      </article>) : <p className="empty-card">Przy tym stoliku nie złożono jeszcze zamówienia.</p>}
    </div>}
    {manual && <Manual categories={categories} close={() => setManual(false)} submit={body => send(`/tables/${table.id}/manual`, body)} />}
    {reason && <Reason title={reason.key === undefined ? 'Odrzuć zamówienie' : 'Anuluj pozycję'} close={() => setReason(undefined)} submit={text => send(`/orders/${reason.id}`, { action: reason.key === undefined ? 'REJECT' : 'CANCEL_LINE', key: reason.key, reason: text })} />}
    {checkout && visit && <Checkout table={table} receipt={receipt} command={command} demo={demo} close={() => setCheckout(false)} />}
    {discard && <Dialog title="Opróżnić koszyk gości?" close={() => setDiscard(undefined)}><div className="stack">
      <p>Usuniesz pozycje, których goście jeszcze nie wysłali do obsługi.</p><Feedback text={error} />
      <button className="button primary" disabled={busy} onClick={() => void run(async () => { await send(`/tables/${table.id}/discard-cart`, discard); setDiscard(undefined); })}>Opróżnij koszyk</button>
    </div></Dialog>}
  </Dialog>;
}

function Reason({ title, close, submit }: { title: string; close: () => void; submit: (reason: string) => Promise<unknown> }) {
  const { busy, error, run } = useAction();
  return <Dialog title={title} close={close}><form className="stack" onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void run(async () => { await submit(String(form.get('reason'))); close(); }); }}>
    <label>Powód<textarea name="reason" autoFocus required maxLength={300} /></label><Feedback text={error} /><button className="button primary" disabled={busy}>Potwierdź</button></form></Dialog>;
}

type Draft = { productId: string; optionId?: string; quantity: number; note: string };
function Manual({ categories, close, submit }: { categories: Category[]; close: () => void; submit: (value: unknown) => Promise<unknown> }) {
  const { busy, error, run } = useAction();
  const [draft, setDraft] = useState<Draft[]>([]);
  const [productId, setProductId] = useState('');
  const [optionId, setOptionId] = useState('');
  const products = categories.flatMap(category => category.products);
  const product = products.find(product => product.id === productId);
  const request = useRef(requestId());
  return <Dialog title="Zamówienie od kelnera" close={close}><div className="stack">
    <form className="stack" onSubmit={event => {
      event.preventDefault(); if (!product) return;
      const form = new FormData(event.currentTarget);
      setDraft(old => [...old, { productId, optionId: optionId || undefined, quantity: Number(form.get('quantity')), note: String(form.get('note')) }]);
      event.currentTarget.reset(); setProductId(''); setOptionId(''); request.current = requestId();
    }}><label>Danie<select value={productId} onChange={event => { setProductId(event.target.value); setOptionId(''); }} required><option value="">Wybierz danie</option>{categories.map(category => <optgroup label={category.name} key={category.id}>{category.products.map(product => <option value={product.id} key={product.id}>{product.name} · {money(product.price)}</option>)}</optgroup>)}</select></label>
      {!!product?.options.length && <label>Opcja<select required value={optionId} onChange={event => setOptionId(event.target.value)}><option value="">Wybierz opcję</option>{product.options.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>}
      <div className="form-grid"><label>Ilość<input name="quantity" type="number" min={1} max={99} defaultValue={1} required /></label><label>Uwagi<input name="note" maxLength={300} /></label></div>
      <button className="button quiet" disabled={busy || !product}><Plus size={17} /> Dopisz do zamówienia</button></form>
    {draft.map((item, index) => <div className="order-line" key={index}><strong>{item.quantity} × {products.find(product => product.id === item.productId)?.name}</strong><button className="text-button" disabled={busy} onClick={() => { setDraft(old => old.filter((_, i) => i !== index)); request.current = requestId(); }}>Usuń</button></div>)}
    <Feedback text={error} /><button className="button primary" disabled={busy || !draft.length} onClick={() => void run(async () => { await submit({ items: draft, request: request.current }); close(); })}>Wyślij do kuchni</button>
  </div></Dialog>;
}

function Checkout({ table, receipt, command, demo, close }: { table: Table; receipt?: Receipt; command: Command; demo: boolean; close: () => void }) {
  const { busy, error, run } = useAction();
  const [method, setMethod] = useState<'CASH' | 'CARD'>('CASH');
  const station = 'local-demo';
  async function print() {
    const prepared = await command<Receipt>(`/fiscal/tables/${table.id}/prepare`, { method }, station);
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

function Kitchen({ version, command }: { version: number; command: Command }) {
  const { data, error: loadError } = useStaffData<KitchenOrder[]>(command, '/staff/kitchen', version);
  const { busy, error, run } = useAction();
  const columns = [
    { name: 'Nowe bony', states: ['ACCEPTED'] }, { name: 'W przygotowaniu', states: ['PREPARING'] }, { name: 'Gotowe i zmiany', states: ['READY', 'SERVED', 'CANCELED'] },
  ];
  return <>{heading('TRYB KUCHNIA', 'Kolejka zamówień', 'Przyjęte zamówienia z sali i telefonów gości.')}
    <Feedback text={loadError || error} /><div className="kitchen-columns">{columns.map(column => {
      const orders = (data ?? []).filter(order => column.states.includes(order.status));
      return <section className="kitchen-column" key={column.name}><h2>{column.name}<span className="section-count">{orders.length}</span></h2>
        {orders.length ? orders.map(order => <article className="panel ticket" key={order.id}><div className="order-head"><strong>Stolik {tableNumber(order.table)}</strong><small>{clock(order.createdAt)}</small></div>
          <Status status={order.status} />{order.lines.map(line => <div className={`order-line ${line.canceled ? 'canceled' : ''}`} key={line.key}><div><strong>{line.quantity} × {line.name}</strong><small>{[line.option, line.note].filter(Boolean).join(' · ')}</small>{line.canceled && <small>Anulowano: {line.canceled}</small>}</div></div>)}
          {['ACCEPTED', 'PREPARING'].includes(order.status) && <button className="button primary" disabled={busy} onClick={() => void run(() => command(`/staff/orders/${order.id}`, { action: order.status === 'ACCEPTED' ? 'PREPARE' : 'READY' }))}>
            {order.status === 'ACCEPTED' ? 'Rozpocznij przygotowanie' : 'Oznacz jako gotowe'}</button>}
        </article>) : <p className="empty-card">{data ? 'Brak bonów' : 'Ładowanie…'}</p>}
      </section>;
    })}</div></>;
}
