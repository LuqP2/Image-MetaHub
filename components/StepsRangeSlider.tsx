import React from 'react';

interface StepsRangeSliderProps {
  min: number;
  max: number;
  value: [number, number];
  onChange: (value: [number, number]) => void;
}


const StepsRangeSlider: React.FC<StepsRangeSliderProps> = ({ min, max, value, onChange }) => {
  // Always use 0-100 for min/max
  const sliderMin = 0;
  const sliderMax = 100;
  // Clamp values
  const left = Math.max(sliderMin, Math.min(value[0], value[1]));
  const right = Math.min(sliderMax, Math.max(value[0], value[1]));

  const handleMinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newMin = Math.min(Number(e.target.value), right - 1);
    onChange([newMin, right]);
  };
  const handleMaxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newMax = Math.max(Number(e.target.value), left + 1);
    onChange([left, newMax]);
  };

  return (
    <div style={{ width: 260, padding: 12, background: 'var(--background, #23272f)', borderRadius: 12, boxShadow: '0 2px 8px #0002', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#aaa', marginBottom: 4 }}>
        <span>Steps</span>
        <span style={{ fontWeight: 500, color: '#fff' }}>{left} - {right}</span>
      </div>
      <div style={{ position: 'relative', height: 32, display: 'flex', alignItems: 'center' }}>
        <input
          type="range"
          min={sliderMin}
          max={sliderMax}
          value={left}
          onChange={handleMinChange}
          style={{ position: 'absolute', width: '100%', pointerEvents: 'auto', zIndex: left < right ? 2 : 3 }}
        />
        <input
          type="range"
          min={sliderMin}
          max={sliderMax}
          value={right}
          onChange={handleMaxChange}
          style={{ position: 'absolute', width: '100%', pointerEvents: 'auto', zIndex: right > left ? 2 : 3 }}
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#888' }}>
        <span>{sliderMin}</span>
        <span>{sliderMax}</span>
      </div>
    </div>
  );
};

export default StepsRangeSlider;
