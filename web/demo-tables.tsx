import { useEffect, useState } from 'react';
import { ArrowUpRight, LayoutGrid } from 'lucide-react';
import { api, ApiError } from './api';
import { tableMenuPath } from './table-menu';
import { Feedback, Mark, message, tableNumber } from './ui';

type Demo = { name: string; tables: { code: string; number: number }[] };

export function DemoTables() {
  const [data, setData] = useState<Demo>();
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    document.title = 'Wybór stolika · RestaurantOS';
    api<Demo>('/demo/tables').then(setData).catch(setError);
  }, []);

  const qrOnly = error instanceof ApiError && error.status === 404;
  return <main className="guest-main demo-tables">
    <div className="staff-title">
      <Mark />
      <span className="eyebrow">RESTAURANTOS</span>
      <h1>{qrOnly ? 'Menu przy stoliku' : 'Wybierz stolik'}</h1>
      <p>{qrOnly ? 'Zeskanuj kod QR na swoim stoliku, aby otworzyć menu.' : data?.name || 'Demo restauracji'}</p>
    </div>
    {!qrOnly && <Feedback text={error ? message(error) : ''} />}
    {!data && !error && <p role="status">Ładowanie stolików…</p>}
    {data && <div className="demo-table-list">{data.tables.map(table => <a key={table.code} className="panel demo-table" href={tableMenuPath(table.code)}>
      <LayoutGrid size={19} aria-hidden="true" />
      <strong>Stolik {tableNumber(table.number)}</strong>
      <ArrowUpRight size={18} aria-hidden="true" />
    </a>)}</div>}
  </main>;
}
