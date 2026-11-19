import { Bell, Check, ClipboardList, Users } from 'lucide-react';
import { callReasonLabel, type Table } from '../shared/model';
import { elapsedLabel, NewOrderSound, useNow } from './service-alerts';
import { tableNumber } from './ui';
import './waiter.css';

function signals(table: Table) {
  const visit = table.visit;
  const call = visit?.calls.find(item => !item.resolvedAt);
  const pending = visit?.orders.filter(order => order.status === 'PENDING') ?? [];
  const ready = visit?.orders.flatMap(order => ['ACCEPTED', 'PREPARING', 'READY'].includes(order.status)
    ? order.lines.filter(line => !line.canceled && (line.readyAt || order.status === 'READY')) : []) ?? [];
  const entries = [
    ...(call ? [{ key: call.id, kind: 'call', label: callReasonLabel[call.reason] ?? callReasonLabel.HELP, since: call.createdAt, icon: Bell }] : []),
    ...pending.map(order => ({ key: order.id, kind: 'pending', label: 'Do akceptacji', since: order.createdAt, icon: ClipboardList })),
  ].sort((a, b) => Date.parse(a.since) - Date.parse(b.since));
  const portions = ready.reduce((sum, line) => sum + line.quantity, 0);
  return { table, call, pending, portions, entries };
}

export function FloorOverview({ tables, scope, onSelect }: { tables?: Table[]; scope: string; onSelect: (id: string) => void }) {
  const now = useNow();
  const rooms = (tables ?? []).map(signals);
  const pendingIds = rooms.flatMap(({ pending }) => pending.map(order => order.id));
  const queue = rooms.flatMap(({ table, entries }) => entries.map(entry => ({ ...entry, table })))
    .sort((a, b) => Date.parse(a.since) - Date.parse(b.since));
  return <>
    <div className="floor-stats">
      <div className="panel metric"><Users size={19} /><span>Otwarte stoliki</span><strong>{rooms.filter(({ table }) => table.visit).length} / {rooms.length}</strong></div>
      <div className="panel metric metric-pending"><ClipboardList size={19} /><span>Do akceptacji</span><strong>{pendingIds.length}</strong></div>
      <div className="panel metric metric-call"><Bell size={19} /><span>Wezwania</span><strong>{rooms.filter(({ call }) => call).length}</strong></div>
      <div className="panel metric metric-ready"><Check size={19} /><span>Porcje do podania</span><strong>{rooms.reduce((sum, room) => sum + room.portions, 0)}</strong></div>
    </div>
    <section className="panel floor-panel">
      <div className="section-heading floor-plan-heading"><div><h2>Sala główna</h2><p>{rooms.length} stolików</p></div>
        <NewOrderSound mode="waiter" scope={scope} ids={tables ? pendingIds : undefined} />
      </div>
      {rooms.length ? <div className="floor-map waiter-map" aria-label="Rozmieszczenie stolików">{rooms.map(({ table, call, pending, portions, entries }) => {
        const kind = call ? 'call' : pending.length ? 'pending' : portions ? 'ready' : table.visit ? 'active' : 'free';
        const label = { call: 'Wezwanie', pending: 'Do akceptacji', ready: 'Do podania', active: 'Zajęty', free: 'Wolny' }[kind];
        const details = [...entries.map(entry => entry.label + ' · ' + elapsedLabel(entry.since, now)), ...(portions ? ['Do podania × ' + portions] : [])];
        return <button key={table.id} className={'table-tile table-' + kind}
          style={{ left: table.x + '%', top: table.y + '%' }} onClick={() => onSelect(table.id)}
          aria-label={'Stolik ' + tableNumber(table.number) + ', ' + (details.join(', ') || label)} title={details.join(' · ') || label}>
          <strong>{tableNumber(table.number)}</strong><small>{label}</small>
          <span className="table-signals" aria-hidden="true">{call && <Bell size={13} />}{!!pending.length && <ClipboardList size={13} />}{portions > 0 && <Check size={13} />}</span>
        </button>;
      })}</div> : <p className="empty-card">{tables ? 'Manager może dodać pierwszy stolik.' : 'Ładowanie sali…'}</p>}
      {!!queue.length && <div className="floor-queue"><h3>Czeka na reakcję</h3><div>{queue.map(({ table, key, label, kind, icon: Icon, since }) =>
        <button key={key} type="button" className={'floor-task table-' + kind} onClick={() => onSelect(table.id)}>
          <Icon size={17} /><span><strong>Stolik {tableNumber(table.number)}</strong><small>{label}</small></span><time dateTime={since}>{elapsedLabel(since, now)}</time>
        </button>)}</div></div>}
    </section>
  </>;
}
