import React, { useEffect, useId, useRef, useState } from 'react';

const count = (value) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value);
const percent = (quantile) => Math.round(quantile * 100) + '%';
const axisCount = (value) => new Intl.NumberFormat('ru-RU', {
  maximumFractionDigits: 1,
  notation: Math.abs(value) >= 10000 ? 'compact' : 'standard',
}).format(value);

export default function ForecastChart({ scenarios, seats }) {
  const container = useRef(null);
  const [width, setWidth] = useState(720);
  const [selectedQuantile, setSelectedQuantile] = useState(0.5);
  const fillId = useId();
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.max(200, Math.min(900, entry.contentRect.width)));
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);

  const points = [...scenarios].sort((a, b) => a.quantile - b.quantile);
  const median = points.find((point) => point.quantile === 0.5);
  const selected = points.find((point) => point.quantile === selectedQuantile) || median;
  const lower = points[0];
  const upper = points[points.length - 1];
  const height = width < 420 ? 280 : 310;
  const margin = { top: 38, right: 20, bottom: 32, left: width < 420 ? 46 : 60 };
  const bottom = height - margin.bottom;
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = bottom - margin.top;
  const low = Math.min(0, seats, ...points.map((point) => point.demand));
  const high = Math.max(0, seats, ...points.map((point) => point.demand));
  const span = Math.max(high - low, 1);
  const roughStep = span / 4;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const step = [1, 2, 2.5, 5, 10].find((factor) => factor * magnitude >= roughStep) * magnitude;
  const minDemand = Math.floor(low / step) * step;
  const maxDemand = Math.ceil((high + span * 0.08) / step) * step;
  const demandRange = maxDemand - minDemand;
  const x = (quantile) => margin.left + ((quantile - 0.1) / 0.8) * plotWidth;
  const y = (demand) => bottom - ((demand - minDemand) / demandRange) * plotHeight;
  const ticks = Array.from({ length: Math.round(demandRange / step) + 1 }, (_, i) => minDemand + i * step);
  const line = points.map((point, i) => `${i ? 'L' : 'M'} ${x(point.quantile)} ${y(point.demand)}`).join(' ');
  const area = `${line} L ${x(upper.quantile)} ${y(0)} L ${x(lower.quantile)} ${y(0)} Z`;
  const visibleQuantiles = width < 420 ? [0.1, 0.5, 0.9] : [0.1, 0.3, 0.5, 0.7, 0.9];

  return (
    <div className="chart-wrap distribution-chart" ref={container}>
      <div className="distribution-summary">
        <div><span>Центральные 80% прогноза</span><strong>{count(lower.demand)} – {count(upper.demand)} <small>чел.</small></strong></div>
        <div><span>Медиана · 50%</span><strong>{count(median.demand)} <small>чел.</small></strong></div>
      </div>
      <div className="chart-legend">
        <span><i className="legend-dot" /> Спрос</span>
        <span><i className="legend-median" /> Медиана</span>
        <span><i className="legend-seat" /> Вместимость</span>
      </div>
      <svg className="demand-chart" viewBox={`0 0 ${width} ${height}`} role="img"
        aria-label={`Распределение спроса по квантилям: медиана ${count(median.demand)}, мест ${count(seats)}`}>
        <defs>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#58a6e8" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#58a6e8" stopOpacity="0.025" />
          </linearGradient>
        </defs>
        <text x={margin.left} y={17} className="chart-axis-label">Спрос, чел.</text>
        <rect x={margin.left} y={margin.top} width={plotWidth} height={Math.max(0, y(seats) - margin.top)} className="chart-over-capacity" />
        {ticks.map((tick, i) => (
          <g key={i}>
            <line x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} className="chart-grid" />
            <text x={margin.left - 10} y={y(tick) + 4} textAnchor="end" className="chart-tick">{axisCount(tick)}</text>
          </g>
        ))}
        <path d={area} fill={`url(#${fillId})`} />
        <line x1={x(0.5)} x2={x(0.5)} y1={margin.top} y2={bottom} className="chart-median-guide" />
        <line x1={margin.left} x2={width - margin.right} y1={y(seats)} y2={y(seats)} className="chart-seat-line" />
        <text x={width - margin.right} y={y(seats) - 8} textAnchor="end" className="chart-seat-label">Мест: {count(seats)}</text>
        <path d={line} className="chart-demand-line" />
        <circle cx={x(selected.quantile)} cy={y(selected.demand)} r={12} className="chart-selection-ring" />
        {points.map((point) => (
          <circle key={point.quantile} cx={x(point.quantile)} cy={y(point.demand)}
            r={point.quantile === 0.5 ? 6 : 4}
            onMouseEnter={() => setSelectedQuantile(point.quantile)}
            onClick={() => setSelectedQuantile(point.quantile)}
            className={'chart-point' + (point.quantile === 0.5 ? ' chart-point-median' : '')}>
            <title>{`С вероятностью ${percent(point.quantile)} спрос не выше ${count(point.demand)} чел.`}</title>
          </circle>
        ))}
        {visibleQuantiles.map((quantile) => (
          <text key={quantile} x={x(quantile)} y={height - 10} textAnchor="middle" className="chart-tick">{percent(quantile)}</text>
        ))}
      </svg>
      <p className="distribution-axis-caption">Вероятность того, что спрос не выше значения точки</p>
      <div className="scenario-picker" role="group" aria-label="Выберите квантиль спроса">
        {points.map((point) => (
          <button key={point.quantile} type="button" aria-pressed={selected.quantile === point.quantile}
            aria-label={`Квантиль ${percent(point.quantile)}`} onClick={() => setSelectedQuantile(point.quantile)}>
            {percent(point.quantile)}
          </button>
        ))}
      </div>
      <div className="scenario-readout" aria-live="polite" aria-atomic="true">
        <div className="scenario-readout-title"><span className="scenario-quantile">{percent(selected.quantile)}</span><p>Спрос не выше <strong>{count(selected.demand)} чел.</strong><small>Продажи в этом сценарии: {count(selected.sales)} билетов</small></p></div>
        <span className={'scenario-capacity-status' + (selected.demand > seats ? ' is-limited' : '')}>
          {selected.demand > seats ? 'Продажи ограничены числом мест' : selected.demand < 0 ? 'Продажи равны нулю' : 'Спрос в пределах вместимости'}
        </span>
      </div>
      <p className="chart-note">
        Между соседними квантилями — около 10% вероятности. Между точками 10% и 90% — центральные 80% прогноза;
        ещё по 10% находятся за его краями. Оранжевая область — спрос выше вместимости.
        {lower.demand < 0 && ' Отрицательный спрос — результат линейной формулы; продажи не могут быть ниже нуля.'}
      </p>
      <details className="scenario-details">
        <summary>Точные значения сценариев</summary>
        <table>
          <caption>Спрос и продажи при введённой цене</caption>
          <thead><tr><th scope="col">Квантиль</th><th scope="col">Спрос, чел.</th><th scope="col">Продажи, чел.</th></tr></thead>
          <tbody>{points.map((point) => (
            <tr key={point.quantile} className={point.quantile === 0.5 ? 'median-row' : ''}>
              <th scope="row">{percent(point.quantile)}{point.quantile === 0.5 ? ' · медиана' : ''}</th>
              <td>{count(point.demand)}</td><td>{count(point.sales)}</td>
            </tr>
          ))}</tbody>
        </table>
      </details>
    </div>
  );
}
