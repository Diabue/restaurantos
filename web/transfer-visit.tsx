import { useRef, useState } from 'react';
import { ArrowRightLeft } from 'lucide-react';
import type { Table } from '../shared/model';
import { requestId } from './api';
import type { Command } from './staff';
import { Dialog, Feedback, message, tableNumber } from './ui';

export function TransferVisit({ table, visitId, tables, command, selectTable }: {
  table: Table; visitId: string; tables: Table[]; command: Command; selectTable: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [targetId, setTargetId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const request = useRef('');
  const free = tables.filter(other => other.id !== table.id && !other.visit);
  const target = free.find(other => other.id === targetId);

  async function transfer() {
    if (busy || !target) return;
    setBusy(true);
    setError('');
    try {
      const result = await command<{ tableId: string }>(`/staff/tables/${table.id}/transfer`, {
        visitId, targetTableId: target.id, request: request.current,
      });
      setOpen(false);
      selectTable(result.tableId);
    } catch (error) { setError(message(error)); }
    finally { setBusy(false); }
  }

  return <><button className="button quiet" onClick={() => { setError(''); setTargetId(''); setOpen(true); }}><ArrowRightLeft size={17} /> Przenieś gości</button>
    {open && <Dialog title={`Przenieś gości ze stolika ${tableNumber(table.number)}`} close={() => { if (!busy) setOpen(false); }}>
      <form className="stack" onSubmit={event => { event.preventDefault(); void transfer(); }}>
        {free.length ? <label>Wolny stolik<select autoFocus required value={target?.id ?? ''} disabled={busy} onChange={event => { setTargetId(event.target.value); request.current = requestId(); }}>
          <option value="">Wybierz stolik</option>
          {free.map(other => <option key={other.id} value={other.id}>Stolik {tableNumber(other.number)} · {other.seats} os.</option>)}
        </select></label> : <p className="empty-card">Wszystkie pozostałe stoliki są zajęte.</p>}
        <p>Goście zachowają swój PIN, koszyk i zamówienia. Dotychczasowy stolik zostanie zwolniony.</p>
        <Feedback text={error} />
        <button className="button primary" disabled={busy || !target}>{target ? `Przenieś na stolik ${tableNumber(target.number)}` : 'Przenieś gości'}</button>
      </form>
    </Dialog>}
  </>;
}
