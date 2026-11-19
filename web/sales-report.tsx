import { useEffect, useMemo, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { salesTimeZone, type DailySales } from '../shared/sales-report';
import type { Command } from './staff';
import { Feedback, message, money } from './ui';

const decimal = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');

function csvUrl(report: DailySales) {
  const rows = [
    ['Dzień sprzedaży', report.day],
    ['Sprzedaż (zł)', decimal(report.total)], ['Gotówka (zł)', decimal(report.cash)],
    ['Karta (zł)', decimal(report.card)], ['Liczba zamówień', String(report.orders)], [],
    ['Danie', 'Sprzedane porcje', 'Sprzedaż (zł)'],
    ...report.dishes.map(dish => [dish.name, String(dish.quantity), decimal(dish.sales)]),
  ];
  const quote = (text: string) => '"' + (/^\s*[=+@-]|^[\t\r\n]/.test(text) ? "'" : '') + text.replaceAll('"', '""') + '"';
  const bytes = new TextEncoder().encode('\uFEFF' + rows.map(row => row.map(quote).join(';')).join('\r\n'));
  const chunks = [];
  for (let i = 0; i < bytes.length; i += 8192) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
  return 'data:text/csv;charset=utf-8;base64,' + btoa(chunks.join(''));
}

export function SalesReport({ command, version }: { command: Command; version: number }) {
  const [day, setDay] = useState(() => new Intl.DateTimeFormat('sv-SE', { timeZone: salesTimeZone }).format(new Date()));
  const [report, setReport] = useState<DailySales>();
  const [error, setError] = useState('');
  const fetchReport = useRef(command);
  fetchReport.current = command;
  useEffect(() => {
    let active = true;
    if (day) fetchReport.current<DailySales>('/manager/sales/' + day)
      .then(value => { if (active) { setReport(value); setError(''); } })
      .catch(err => { if (active) setError(message(err)); });
    return () => { active = false; };
  }, [day, version]);
  const url = useMemo(() => report && csvUrl(report), [report]);
  return <section className="panel manager-panel stack">
    <div className="section-heading floor-plan-heading"><div><h2>Raport sprzedaży</h2>
      <p>Rozliczone zamówienia według dnia zapłaty w Polsce.</p></div>
      <label>Dzień sprzedaży<input type="date" value={day} onChange={e => { setDay(e.target.value); setError(''); }} /></label></div>
    <Feedback text={error} />
    {day && report?.day === day ? <>
      <div className="sales-metrics">{[['Sprzedaż', money(report.total)], ['Zamówienia', report.orders],
        ['Gotówka', money(report.cash)], ['Karta', money(report.card)]].map(([label, value]) =>
        <div key={label}><small>{label}</small><strong>{value}</strong></div>)}</div>
      <div className="order-head"><h3>Sprzedane dania</h3><a className="button quiet" href={url} download={`RestaurantOS-sprzedaz-${day}.csv`}><Download size={17} /> Pobierz CSV</a></div>
      {report.dishes.length ? <table className="sales-table"><thead><tr><th>Danie</th><th>Porcje</th><th>Sprzedaż</th></tr></thead>
        <tbody>{report.dishes.map((dish, index) => <tr key={index}><td>{dish.name}</td><td>× {dish.quantity}</td><td>{money(dish.sales)}</td></tr>)}</tbody></table>
        : <p className="empty-card">Brak rozliczonej sprzedaży w tym dniu.</p>}
    </> : !error && <p>{day ? 'Ładowanie raportu…' : 'Wybierz dzień sprzedaży.'}</p>}
  </section>;
}
