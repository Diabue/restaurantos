import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Check, Pencil, Plus } from 'lucide-react';
import type { Table } from '../shared/model';
import type { Command } from './staff';
import { Feedback, message, tableNumber } from './ui';

type Point = Pick<Table, 'x' | 'y'>;
type Move = Point & { id: string };
type Drag = {
  pointer: number;
  table: Table;
  start: Point;
  clientX: number;
  clientY: number;
  moved: boolean;
};

function limit(value: number, inset: number) {
  return Math.min(100 - inset, Math.max(inset, Math.round(value)));
}

export function FloorPlan({ tables, command, editTable, onSaved }: {
  tables: Table[];
  command: Command;
  editTable: (table?: Table) => void;
  onSaved: (moves: Move[]) => void;
}) {
  const map = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag>(undefined);
  const ignoreClick = useRef<string>(undefined);
  const [editing, setEditing] = useState(false);
  const [positions, setPositions] = useState<Record<string, Point>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  function position(table: Table, point: Point) {
    setPositions(current => {
      const next = { ...current };
      if (point.x === table.x && point.y === table.y) delete next[table.id];
      else next[table.id] = point;
      return next;
    });
  }

  function move(table: Table, point: Point, tile: HTMLButtonElement) {
    const area = map.current;
    if (!area) return;
    const insetX = Math.max(7, Math.ceil(tile.offsetWidth / area.clientWidth * 50));
    const insetY = Math.max(12, Math.ceil(tile.offsetHeight / area.clientHeight * 50));
    position(table, { x: limit(point.x, insetX), y: limit(point.y, insetY) });
  }

  function start(event: PointerEvent<HTMLButtonElement>, table: Table) {
    if (!drag.current) ignoreClick.current = undefined;
    if (!editing || saving || drag.current || event.button !== 0) return;
    drag.current = {
      pointer: event.pointerId, table, start: positions[table.id] ?? table,
      clientX: event.clientX, clientY: event.clientY, moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function follow(event: PointerEvent<HTMLButtonElement>) {
    const active = drag.current;
    const area = map.current;
    if (!active || !area || event.pointerId !== active.pointer) return;
    const dx = event.clientX - active.clientX;
    const dy = event.clientY - active.clientY;
    if (!active.moved && Math.hypot(dx, dy) < 5) return;
    active.moved = true;
    move(active.table, { x: active.start.x + dx / area.clientWidth * 100, y: active.start.y + dy / area.clientHeight * 100 }, event.currentTarget);
  }

  function finish(event: PointerEvent<HTMLButtonElement>, canceled: boolean) {
    const active = drag.current;
    if (!active || event.pointerId !== active.pointer) return;
    drag.current = undefined;
    if (!active.moved) return;
    if (canceled) position(active.table, active.start);
    else ignoreClick.current = active.table.id;
  }

  function keyMove(event: KeyboardEvent<HTMLButtonElement>, table: Table) {
    if (!editing || saving) return;
    const offsets: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const offset = offsets[event.key];
    if (!offset) return;
    event.preventDefault();
    const [dx, dy] = offset;
    const step = event.shiftKey ? 5 : 1;
    const point = positions[table.id] ?? table;
    move(table, { x: point.x + step * dx, y: point.y + step * dy }, event.currentTarget);
  }

  async function save() {
    const moves = Object.entries(positions).map(([id, point]) => ({ id, ...point }));
    if (!moves.length || saving) return;
    setSaving(true);
    setError('');
    try {
      await command('/manager/layout', { moves });
      onSaved(moves);
      setPositions({});
      setEditing(false);
      setNotice('Zapisano plan sali.');
    } catch (error) {
      setError(message(error));
    } finally {
      setSaving(false);
    }
  }

  return <section className="panel manager-panel stack">
    <div className="section-heading floor-plan-heading">
      <div><h2>Plan sali</h2>{editing && <p>Przeciągnij stoliki palcem lub myszą. Dotknij stolika, aby zmienić numer lub liczbę miejsc.</p>}</div>
      <div className="row-actions">
        <button className="button quiet" disabled={saving} onClick={() => editTable()}><Plus size={17} /> Dodaj stolik</button>
        {editing ? <>
          <button className="button quiet" disabled={saving} onClick={() => { setEditing(false); setPositions({}); setError(''); }}>Anuluj</button>
          <button className="button primary" disabled={saving || Object.keys(positions).length === 0} onClick={() => void save()}><Check size={17} /> Zapisz plan</button>
        </> : <button className="button primary" onClick={() => { setEditing(true); setNotice(''); }}><Pencil size={17} /> Edytuj plan</button>}
      </div>
    </div>
    <Feedback text={error} />
    <Feedback text={notice} alert={false} />
    {tables.length ? <div ref={map} className={`floor-map${editing ? ' floor-map-editing' : ''}`} aria-label="Plan rozmieszczenia stolików">
      {tables.map(table => {
        const point = positions[table.id] ?? table;
        return <button type="button" key={table.id} className={`table-tile${positions[table.id] ? ' table-active' : ''}`}
          style={{ left: `${point.x}%`, top: `${point.y}%` }} disabled={saving} aria-label={`Stolik ${tableNumber(table.number)}, ${table.seats} miejsc`}
          onPointerDown={event => start(event, table)} onPointerMove={follow} onPointerUp={event => finish(event, false)}
          onPointerCancel={event => finish(event, true)} onLostPointerCapture={event => finish(event, true)}
          onKeyDown={event => keyMove(event, table)} onClick={event => {
            if (event.detail && ignoreClick.current === table.id) { ignoreClick.current = undefined; return; }
            editTable(table);
          }}>
          <strong>{tableNumber(table.number)}</strong><small>{table.seats} os.</small>
        </button>;
      })}
    </div> : <p className="empty-card">Dodaj pierwszy stolik, aby przygotować plan sali.</p>}
  </section>;
}
