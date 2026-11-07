import type { ReactNode } from 'react';

export function BoardPropertyRow({ label, children }: { label: string; children: ReactNode }) {
  return <div className="board-property-row"><span className="board-property-label">{label}</span><div className="board-property-value">{children}</div></div>;
}

/** Native picker, with the same input/blur transaction boundaries as other properties. */
export function BoardColorField({ label, value, mixed = false, disabled, onChange, onBlur, presets, onPreset }: {
  label: string; value: string; mixed?: boolean; disabled?: boolean;
  onChange(value: string): void; onBlur?(): void; presets?: readonly string[]; onPreset?(value: string): void;
}) {
  return <div className="board-color-control">
    <label className={`board-color-field${mixed ? ' board-color-field--mixed' : ''}`}>
      <input type="color" aria-label={label} disabled={disabled} value={value} onChange={event => onChange(event.target.value)} onBlur={onBlur} />
      <span aria-hidden="true">{mixed ? 'Mixed' : value.toUpperCase()}</span>
    </label>
    {presets && <div className="board-color-palette" aria-label={`${label} presets`}>{presets.map(color => <button type="button" key={color} disabled={disabled} aria-label={`Color ${color}`} title={color.toUpperCase()} aria-pressed={!mixed && value === color} style={{ backgroundColor: color }} onClick={() => (onPreset ?? onChange)(color)} />)}</div>}
  </div>;
}
