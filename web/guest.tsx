import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Bell, Check, ChevronRight, Clock3, ImageOff, Minus, Plus, ShoppingBag, Trash2, Utensils } from 'lucide-react';
import type { GuestState, Line, Menu, Product } from '../shared/model';
import { api, ApiError, requestId, useLive } from './api';
import { clock, Dialog, Feedback, Mark, message, money, Status, tableNumber } from './ui';

const empty: GuestState = { cart: [], total: 0, orders: [] };
type Intent = { action: 'add'; product: Product } | { action: 'call' } | { action: 'cart' };

const guestStorage = {
  read(key: string) {
    try { return localStorage.getItem(key) || sessionStorage.getItem(key) || ''; }
    catch { return ''; }
  },
  save(key: string, secret: string) {
    try {
      if (localStorage.getItem(key) !== secret) localStorage.setItem(key, secret);
      sessionStorage.removeItem(key);
    } catch { /* The visit remains available in the current tab when storage is disabled. */ }
  },
  migrate(key: string, secret: string) {
    try {
      if (sessionStorage.getItem(key) !== secret || localStorage.getItem(key)) return;
      localStorage.setItem(key, secret);
      sessionStorage.removeItem(key);
    } catch { /* Storage may be disabled. */ }
  },
  remove(key: string, secret: string) {
    try {
      if (localStorage.getItem(key) === secret) localStorage.removeItem(key);
      if (sessionStorage.getItem(key) === secret) sessionStorage.removeItem(key);
    } catch { /* Storage may be disabled. */ }
  },
};

export function Guest({ code }: { code: string }) {
  const storageKey = `restaurant:guest:${code}`;
  const [secret, setSecret] = useState(() => guestStorage.read(storageKey));
  const [menu, setMenu] = useState<Menu>();
  const [guest, setGuest] = useState(empty);
  const [category, setCategory] = useState('');
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [cartTab, setCartTab] = useState<'cart' | 'orders'>('cart');
  const [intent, setIntent] = useState<Intent>();
  const [pin, setPin] = useState('');
  const [product, setProduct] = useState<Product>();
  const [option, setOption] = useState('');
  const [note, setNote] = useState('');
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const refreshSequence = useRef(0);
  const submission = useRef<{ snapshot: string; key: string } | null>(null);
  const pendingCart = useRef<{ fingerprint: string; key: string } | null>(null);
  const currentSecret = useRef(secret);
  currentSecret.current = secret;

  const refresh = useCallback(async (activeSecret = currentSecret.current) => {
    const sequence = ++refreshSequence.current;
    const [menuResult, guestResult] = await Promise.allSettled([
      api<Menu>(`/menu/${encodeURIComponent(code)}`), activeSecret ? api<GuestState>('/guest', { secret: activeSecret }) : Promise.resolve(empty),
    ]);
    if (sequence !== refreshSequence.current) return;
    if (menuResult.status === 'fulfilled') { setMenu(menuResult.value); setLoadError(''); }
    else setLoadError(message(menuResult.reason));
    if (guestResult.status === 'fulfilled') {
      if (activeSecret) guestStorage.migrate(storageKey, activeSecret);
      setGuest(guestResult.value);
    } else if (guestResult.reason instanceof ApiError && guestResult.reason.status === 401) {
      guestStorage.remove(storageKey, activeSecret);
      currentSecret.current = '';
      setSecret('');
      setGuest(empty);
      setNotice('Sesja stolika została zakończona.');
    }
  }, [code, storageKey]);

  useEffect(() => { void refresh(); }, [refresh]);
  const number = menu?.table.number;
  useEffect(() => {
    if (number !== undefined) document.title = `Stolik ${tableNumber(number)} · RestaurantOS`;
  }, [number]);
  useEffect(() => { setPin(''); }, [menu?.table.pinConfigured]);
  useLive(secret ? 'guest' : 'menu', secret, code, () => { void refresh(); });

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try { await action(); }
    catch (error) { setError(message(error)); if (!(error instanceof ApiError) || error.status !== 0) void refresh(); }
    finally { setBusy(false); }
  }

  async function mutateCart(command: Record<string, unknown>, activeSecret: string) {
    const fingerprint = JSON.stringify(command);
    if (pendingCart.current?.fingerprint !== fingerprint) pendingCart.current = { fingerprint, key: requestId() };
    try { await api('/guest/cart', { secret: activeSecret, body: { ...command, request: pendingCart.current.key } }); }
    catch (error) { if (!(error instanceof ApiError) || error.status !== 0) pendingCart.current = null; throw error; }
    pendingCart.current = null;
    await refresh(activeSecret);
  }

  async function add(item: Product, activeSecret: string, optionId?: string, extraNote = '') {
    await mutateCart({ action: 'add', item: { productId: item.id, optionId, note: extraNote, quantity: 1 } }, activeSecret);
    setProduct(undefined);
    setNotice(`Dodano do koszyka: ${item.name}.`);
  }

  async function perform(next: Intent, activeSecret: string) {
    if (next.action === 'call') {
      await api('/guest/call', { secret: activeSecret, body: {} });
      await refresh(activeSecret);
      setNotice('Obsługa dostała Twoje wezwanie.');
    } else if (next.action === 'cart') {
      setCartTab('cart');
      setCartOpen(true);
    } else if (next.product.options.length) {
      setOption(''); setNote(''); setProduct(next.product);
    } else await add(next.product, activeSecret);
  }

  function start(next: Intent) {
    setError('');
    if (!secret) { setPin(''); setIntent(next); }
    else void run(() => perform(next, secret));
  }

  function connect(event: FormEvent) {
    event.preventDefault();
    const next = intent;
    if (!next || !menu) return;
    const action = menu.table.pinConfigured ? 'join' : 'start';
    void run(async () => {
      const result = await api<{ secret: string }>(`/menu/${encodeURIComponent(code)}/${action}`, { body: { pin } });
      guestStorage.save(storageKey, result.secret);
      currentSecret.current = result.secret;
      setSecret(result.secret);
      setPin('');
      setIntent(undefined);
      await refresh(result.secret);
      await perform(next, result.secret);
    });
  }

  function updateLine(line: Line, delta?: number) {
    void run(() => mutateCart({ action: 'change', key: line.key, delta }, secret));
  }

  function submit() {
    void run(async () => {
      const snapshot = guest.cart.map(({ key, quantity, price }) => ({ key, quantity, price }));
      const fingerprint = JSON.stringify(snapshot);
      if (submission.current?.snapshot !== fingerprint) submission.current = { snapshot: fingerprint, key: requestId() };
      await api('/guest/order', { secret, body: { request: submission.current.key, snapshot } });
      submission.current = null;
      await refresh(secret);
      setCartTab('orders');
      setNotice('Czeka na potwierdzenie kelnera');
    });
  }

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  if (!menu) return <main className="loading"><Mark /><h1>{loadError ? 'Menu jest niedostępne' : 'Otwieramy menu…'}</h1><Feedback text={loadError} />
    {loadError && <button className="button primary" onClick={() => void refresh()}>Spróbuj ponownie</button>}</main>;

  const categories = menu.categories.filter(item => item.products.length > 0);
  const selected = categories.find(item => item.id === category) ?? categories[0];
  const count = guest.cart.reduce((total, line) => total + line.quantity, 0);
  const { restaurant, table } = menu;

  return <div className="guest-page">
    <header className="guest-header">
      <div className="header-inner"><a className="brand" href={location.pathname} aria-label="Początek menu"><Mark image={restaurant.logo} /><span>{restaurant.name}<small>MENU RESTAURACJI</small></span></a>
        <button className="button quiet call-button" disabled={busy || !!guest.call} onClick={() => start({ action: 'call' })}><Bell size={17} />{guest.call ? 'Obsługa wezwana' : 'Wezwij obsługę'}</button></div>
    </header>
    <main className="guest-main">
      <section className="hero" aria-label="Restauracja">
        {restaurant.image && <img src={restaurant.image} alt="" fetchPriority="high" />}
        <div className="hero-shade" /><div className="hero-content">
          <span className="hero-table"><Utensils size={14} /> STOLIK {tableNumber(menu.table.number)}</span>
          <h1>{restaurant.name}</h1><p>{restaurant.tagline || 'Wybierz coś dla siebie z naszego menu.'}</p>
        </div>
      </section>
      <div className="menu-tabs" aria-label="Kategorie menu" role="group">{categories.map(item => <button key={item.id} className={selected?.id === item.id ? 'selected' : ''}
        aria-pressed={selected?.id === item.id} onClick={() => setCategory(item.id)}>{item.name}</button>)}</div>
      <section className="menu-section" aria-label={selected?.name || 'Menu'}>
        <div className="section-heading"><div><span className="eyebrow">MENU</span><h2>{selected?.name || 'Nasze menu'}</h2></div>
          {selected && <span className="section-count">{selected.products.length} {selected.products.length === 1 ? 'pozycja' : 'pozycje'}</span>}</div>
        <Feedback text={!intent && !product && !cartOpen ? error : ''} />
        {selected ? <div className="dish-list">{selected.products.map(item => <article className="dish" key={item.id}>
          <div className="dish-photo">{item.image && !failedImages.includes(item.image) ? <img key={item.image} src={item.image} alt="" loading="lazy" onError={() => setFailedImages(old => [...old, item.image])} /> : <ImageOff size={24} />}</div>
          <div className="dish-copy"><h3>{item.name}</h3><p>{item.description}</p></div>
          <div className="dish-actions"><strong>{money(item.price)}</strong><button className="add-button" aria-label={`Dodaj: ${item.name}`} disabled={busy} onClick={() => start({ action: 'add', product: item })}><Plus size={20} /></button></div>
        </article>)}</div> : <p className="empty-card">Menu będzie dostępne wkrótce.</p>}
      </section>
      <footer className="guest-footer"><Utensils size={15} /> Smacznego! <span>·</span> {restaurant.name}</footer>
    </main>
    <div className="guest-action"><button className="cart-fab" onClick={() => {
      if (!secret && table.pinConfigured) { start({ action: 'cart' }); return; }
      setError(''); setCartTab(!count && guest.orders.length ? 'orders' : 'cart'); setCartOpen(true);
    }}>
      <span className="cart-fab-icon"><ShoppingBag size={22} />{count > 0 && <b>{count}</b>}</span>
      <span className="cart-fab-label">Koszyk<small>{money(guest.total)}</small></span><ChevronRight size={17} />
    </button></div>
    {notice && <div className="toast" role="status"><Check size={16} />{notice}</div>}
    {intent && <Dialog title={table.pinConfigured ? 'Dołącz do stolika' : 'Ustaw PIN stolika'} close={() => { if (!busy) { setIntent(undefined); setError(''); } }}>
      <form onSubmit={connect} className="stack">
        <p>{table.pinConfigured
          ? `Wpisz 6-cyfrowy PIN ustawiony przez gości przy stoliku ${tableNumber(table.number)}.`
          : `Wybierz 6 cyfr dla stolika ${tableNumber(table.number)}. Podaj PIN osobom przy stole, które chcą dołączyć do wspólnego rachunku.`}</p>
        <label>PIN stolika<input autoFocus type="password" value={pin} onChange={event => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="off" placeholder="6 cyfr" required pattern="[0-9]{6}" /></label>
        <Feedback text={error} /><button className="button primary" disabled={busy || pin.length !== 6}>{table.pinConfigured ? 'Dołącz' : 'Ustaw PIN i dołącz'}</button>
      </form>
    </Dialog>}
    {product && <Dialog title={product.name} close={() => { if (!busy) { setProduct(undefined); setError(''); } }} sheet>
      <form className="stack" onSubmit={event => { event.preventDefault(); void run(() => add(product, secret, option, note)); }}>
        <fieldset><legend>Wybierz opcję</legend>{product.options.map(item => <label className="option" key={item.id}><input type="radio" name="variant" required value={item.id} checked={option === item.id} onChange={() => setOption(item.id)} />
          {item.name}<strong>{money(product.price + item.extra)}</strong></label>)}</fieldset>
        <label>Uwaga do dania<input value={note} onChange={event => setNote(event.target.value)} maxLength={300} placeholder="Opcjonalnie" /></label>
        <Feedback text={error} /><button className="button primary" disabled={busy || !option}><Plus size={18} /> Dodaj do koszyka</button>
      </form>
    </Dialog>}
    {cartOpen && <Dialog title={`Stolik ${tableNumber(menu.table.number)}`} close={() => { if (!busy) { setCartOpen(false); setError(''); } }} sheet>
      <div className="segmented"><button className={cartTab === 'cart' ? 'selected' : ''} onClick={() => setCartTab('cart')}>Koszyk ({count})</button><button className={cartTab === 'orders' ? 'selected' : ''} onClick={() => setCartTab('orders')}>Zamówienia ({guest.orders.length})</button></div>
      <Feedback text={error} />
      {cartTab === 'cart' ? <div className="stack">
        {!count && <p className="empty-card">Koszyk jest pusty. Dodaj coś z menu.</p>}
        {guest.cart.map(line => <div className="cart-line" key={line.key}><div><strong>{line.name}</strong><small>{[line.option, line.note].filter(Boolean).join(' · ')}</small><b>{money(line.price * line.quantity)}</b></div>
          <div className="quantity"><button aria-label={`Odejmij: ${line.name}`} disabled={busy} onClick={() => updateLine(line, -1)}><Minus size={16} /></button><span>{line.quantity}</span><button aria-label={`Dodaj: ${line.name}`} disabled={busy} onClick={() => updateLine(line, 1)}><Plus size={16} /></button>
            <button aria-label={`Usuń: ${line.name}`} disabled={busy} onClick={() => updateLine(line)}><Trash2 size={16} /></button></div></div>)}
        <div className="cart-total"><span>Suma koszyka</span><strong>{money(guest.total)}</strong></div><button className="button primary" disabled={!count || busy} onClick={submit}>Zamów <ChevronRight size={17} /></button>
      </div> : <div className="stack">
        {!guest.orders.length && <p className="empty-card">Ten stolik nie złożył jeszcze zamówienia.</p>}
        {guest.orders.map(order => <article className="order-card" key={order.id}><div className="order-head"><Status status={order.status} /><small><Clock3 size={13} />{clock(order.createdAt)}</small></div>
          {order.reason && <Feedback text={order.reason} />}{order.lines.map(line => <div className={`order-line ${line.canceled ? 'canceled' : ''}`} key={line.key}><div><strong>{line.quantity} × {line.name}</strong>{line.option && <small>{line.option}</small>}{line.canceled && <small>Anulowano: {line.canceled}</small>}</div></div>)}</article>)}
      </div>}
    </Dialog>}
  </div>;
}
