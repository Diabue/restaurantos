import { useRef, useState } from 'react';
import { ChevronRight, Minus, Plus, Search, Trash2 } from 'lucide-react';
import type { Category, Option, Product } from '../shared/model';
import { ApiError, requestId } from './api';
import { Dialog, Feedback, message, money } from './ui';

type DraftItem = {
  id: string; productId: string; optionId?: string; name: string; option?: string;
  price: number; quantity: number; note: string;
};

function searchable(value: string) {
  return value.toLocaleLowerCase('pl').replaceAll('ł', 'l').normalize('NFD').replace(/\p{M}/gu, '').trim();
}

export function Manual({ categories, close, submit }: { categories: Category[]; close: () => void; submit: (value: unknown) => Promise<unknown> }) {
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [choosing, setChoosing] = useState<string>();
  const [draft, setDraft] = useState<DraftItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  const request = useRef('');
  const locked = busy || uncertain;
  const visible = categories.filter(category => !categoryId || categoryId === category.id)
    .flatMap(category => category.products.filter(product => product.available && searchable(product.name).includes(searchable(query))));
  const variant = visible.find(product => product.id === choosing);
  const total = draft.reduce((sum, item) => sum + item.price * item.quantity, 0);

  function change(items: DraftItem[]) {
    setDraft(items);
    request.current = '';
    setError('');
  }

  function add(product: Product, option?: Option) {
    const match = draft.find(item => item.productId === product.id && item.optionId === option?.id && !item.note);
    if (match && match.quantity >= 99) { setError('W jednej pozycji można zamówić do 99 porcji.'); return; }
    if (!match && draft.length >= 50) { setError('W jednym zamówieniu można dodać do 50 pozycji.'); return; }
    if (match) change(draft.map(item => item === match ? { ...item, quantity: item.quantity + 1 } : item));
    else change([...draft, { id: requestId(), productId: product.id, optionId: option?.id, name: product.name,
      option: option?.name, price: product.price + (option?.extra ?? 0), quantity: 1, note: '' }]);
    setChoosing(undefined);
  }

  async function send() {
    if (busy || !draft.length) return;
    setBusy(true); setError('');
    if (!request.current) request.current = requestId();
    try {
      await submit({ request: request.current, items: draft.map(({ productId, optionId, quantity, note }) => ({ productId, optionId, quantity, note })) });
      close();
    } catch (error) {
      const retry = error instanceof ApiError && (error.status === 0 || error.status >= 500);
      setUncertain(retry);
      setError(retry ? 'Brak potwierdzenia. Ponów wysłanie tego samego zamówienia.' : message(error));
    } finally { setBusy(false); }
  }

  return <Dialog title="Zamówienie od kelnera" close={() => { if (!busy) close(); }}><div className="stack manual-order">
    <label>Szukaj dania<span className="manual-search"><Search size={18} aria-hidden="true" /><input type="search" value={query}
      disabled={locked} placeholder="Nazwa dania" onChange={event => { setQuery(event.target.value); setCategoryId(''); setChoosing(undefined); }} /></span></label>
    <div className="manual-categories" role="group" aria-label="Kategoria dania">
      <button aria-pressed={!categoryId} disabled={locked} onClick={() => { setCategoryId(''); setChoosing(undefined); }}>Wszystkie</button>
      {categories.filter(category => category.products.length).map(category =>
        <button key={category.id} aria-pressed={category.id === categoryId} disabled={locked} onClick={() => { setCategoryId(category.id); setQuery(''); setChoosing(undefined); }}>{category.name}</button>)}
    </div>
    <div className="manual-products">{visible.map(product =>
      <button key={product.id} className="manual-product" disabled={locked} aria-label={(product.options.length ? 'Wybierz wariant: ' : 'Dodaj: ') + product.name}
        onClick={() => product.options.length ? setChoosing(product.id) : add(product)}>
        <span><strong>{product.name}</strong><small>{money(product.price)}</small></span>
        {product.options.length ? <ChevronRight size={18} /> : <Plus size={18} />}
      </button>)}
      {!visible.length && <p className="empty-card">Brak pasujących dań.</p>}
    </div>
    {variant && <Dialog title={variant.name} close={() => setChoosing(undefined)}><div className="stack">
      <p>Wybierz wariant</p>{variant.options.map(option => <button className="button quiet manual-variant" key={option.id} onClick={() => add(variant, option)}>
        {option.name}<strong>{money(variant.price + option.extra)}</strong><Plus size={16} /></button>)}
    </div></Dialog>}
    {draft.length > 0 && <div className="manual-draft">{draft.map(item => <div className="manual-item" key={item.id}>
      <div className="manual-item-head"><strong>{item.name}{item.option && ' · ' + item.option}</strong><b>{money(item.price * item.quantity)}</b></div>
      <div className="manual-item-tools">
        <input aria-label={'Uwaga do pozycji ' + item.name} placeholder="Uwaga do dania" maxLength={300} value={item.note} disabled={locked}
          onChange={event => change(draft.map(row => row.id === item.id ? { ...row, note: event.target.value } : row))} />
        <div className="quantity">
          <button aria-label={'Odejmij porcję: ' + item.name} disabled={locked || item.quantity === 1}
            onClick={() => change(draft.map(row => row.id === item.id ? { ...row, quantity: row.quantity - 1 } : row))}><Minus size={15} /></button>
          <span>{item.quantity}</span><button aria-label={'Dodaj porcję: ' + item.name} disabled={locked || item.quantity >= 99}
            onClick={() => change(draft.map(row => row.id === item.id ? { ...row, quantity: row.quantity + 1 } : row))}><Plus size={15} /></button>
          <button aria-label={'Usuń: ' + item.name} disabled={locked} onClick={() => change(draft.filter(row => row.id !== item.id))}><Trash2 size={15} /></button>
        </div>
      </div>
    </div>)}</div>}
    <Feedback text={error} /><button className="button primary" disabled={busy || !draft.length} onClick={() => void send()}>
      {busy ? 'Wysyłanie…' : uncertain ? 'Ponów wysłanie' : 'Wyślij zamówienie'}{draft.length > 0 && ' · ' + money(total)}
    </button>
  </div></Dialog>;
}
