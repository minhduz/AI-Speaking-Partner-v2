'use client';

import { useEffect, useRef } from 'react';

interface WaveformProps {
  isRecording: boolean;
  analyser: AnalyserNode | null;
}

const BAR_COUNT = 40;
const BAR_MAX_H = 100;

const NOISE = [
  0, 5, -4, 8, -6, 3, -8, 2, 9, -4, 6, -2, 8, -6, 4, 10, 6, -3, 8, -5,
  -5, 8, -3, 6, 10, 4, -6, 8, -2, 6, -4, 9, 2, -8, 3, -6, 8, -4, 5, 0,
];

// Precomputed base scales (0–1), used with scaleY transform
const BASE_SCALES = Array.from({ length: BAR_COUNT }, (_, i) => {
  const center = (BAR_COUNT - 1) / 2;
  const dist = Math.abs(i - center) / center;
  const h = Math.max(6, Math.min(BAR_MAX_H, Math.round((1 - dist * dist) * 90 + 8 + NOISE[i])));
  return h / BAR_MAX_H;
});

const BAR_COLORS = Array.from({ length: BAR_COUNT }, (_, i) => {
  const center = (BAR_COUNT - 1) / 2;
  const dist = Math.abs(i - center) / center;
  if (dist < 0.2) return '#58cc02';
  if (dist < 0.38) return '#73d82f';
  if (dist < 0.54) return '#8ee65d';
  if (dist < 0.68) return '#2fb8ff';
  if (dist < 0.8) return '#75d3ff';
  if (dist < 0.9) return '#b8ecff';
  return '#d7ffb8';
});

export function Waveform({ isRecording, analyser }: WaveformProps) {
  const barsRef = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    let frameId: number;
    let isActive = true;
    let phase = 0;

    if (!isRecording || !analyser) {
      const animate = () => {
        if (!isActive) return;
        phase += 0.035;
        const bars = barsRef.current;
        for (let i = 0; i < bars.length; i++) {
          const bar = bars[i];
          if (!bar) continue;
          const scale = BASE_SCALES[i] * (0.55 + 0.45 * Math.sin(phase + i * 0.32));
          bar.style.transform = `scaleY(${Math.max(0.06, scale)})`;
        }
        frameId = requestAnimationFrame(animate);
      };
      frameId = requestAnimationFrame(animate);
    } else {
      // Pre-allocate outside the loop to avoid GC pressure
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const step = Math.floor(dataArray.length / BAR_COUNT);

      const animate = () => {
        if (!isActive) return;
        analyser.getByteFrequencyData(dataArray);
        const bars = barsRef.current;
        for (let i = 0; i < bars.length; i++) {
          const bar = bars[i];
          if (!bar) continue;
          const scale = Math.max(0.06, dataArray[i * step] / 255);
          bar.style.transform = `scaleY(${scale})`;
        }
        frameId = requestAnimationFrame(animate);
      };
      frameId = requestAnimationFrame(animate);
    }

    return () => {
      isActive = false;
      cancelAnimationFrame(frameId);
    };
  }, [isRecording, analyser]);

  return (
    <div
      className="flex items-center justify-center gap-1"
      style={{ height: `${BAR_MAX_H}px` }}
    >
      {Array.from({ length: BAR_COUNT }).map((_, i) => (
        <div
          key={i}
          ref={(el) => { barsRef.current[i] = el; }}
          style={{
            width: '7px',
            height: `${BAR_MAX_H}px`,
            backgroundColor: BAR_COLORS[i],
            borderRadius: '9999px',
            transform: `scaleY(${BASE_SCALES[i]})`,
            willChange: 'transform',
          }}
        />
      ))}
    </div>
  );
}
