import { useEffect } from 'react';
import { Mark } from './ui';

export function GuestEntry() {
  useEffect(() => { document.title = 'Menu restauracji · RestaurantOS'; }, []);
  return <main className="guest-main guest-entry">
    <div className="staff-title">
      <Mark />
      <span className="eyebrow">RESTAURANTOS</span>
      <h1>Menu restauracji</h1>
      <p>Zeskanuj kod QR przy swoim stole, aby otworzyć menu i złożyć zamówienie.</p>
    </div>
  </main>;
}
