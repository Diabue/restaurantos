import { assetUrl } from './api';
import { useEffect, useRef, useState } from 'react';
import { Feedback } from './ui';

export function ProductPhoto({ image = '' }: { image?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [address, setAddress] = useState(image);
  const [selected, setSelected] = useState<File>();
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!selected) { setPreview(''); return; }
    const url = URL.createObjectURL(selected);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [selected]);

  const source = selected ? preview : address;
  const canPreview = /^(?:blob:|https:\/\/|\/(?:images|uploads)\/)/i.test(source);
  return <fieldset className="stack">
    <legend>Zdjęcie dania</legend>
    <label>Wybierz plik ze zdjęciem
      <input ref={input} type="file" name="photo" accept="image/jpeg,image/png,image/webp" onChange={event => {
        const file = event.currentTarget.files?.[0];
        const problem = file && file.size > 5 * 1024 * 1024 ? 'Zdjęcie może mieć maksymalnie 5 MB.' : '';
        event.currentTarget.setCustomValidity(problem);
        setError(problem);
        setSelected(problem ? undefined : file);
      }} />
    </label>
    <p>JPG, PNG lub WebP, maksymalnie 5 MB. Plik wgra się po zapisaniu dania.</p>
    <Feedback text={error} />
    {(selected || error) && <button className="button quiet" type="button" onClick={() => {
      if (input.current) { input.current.value = ''; input.current.setCustomValidity(''); }
      setSelected(undefined);
      setError('');
    }}>Wyczyść wybór pliku</button>}
    <label>Adres zdjęcia (opcjonalnie)<input name="image" value={address} onChange={event => setAddress(event.target.value)} readOnly={!!selected} /></label>
    {canPreview && <img className="venue-preview" src={assetUrl(source)} alt="Podgląd zdjęcia dania" />}
  </fieldset>;
}
