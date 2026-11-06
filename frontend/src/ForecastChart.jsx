import React, { useEffect, useRef, useState } from 'react';

const margin = { top: 28, right: 28, bottom: 54, left: 62 };
const quantileLabels = new Map([
  [0.1, '10%'], [0.2, '20%'], [0.3, '30%'],
  [0.4, '40%'], [0.5, '50%'], [0.6, '60%'],
  [0.7, '70%'], [0.8, '80%'], [0.9, '90%'],
]);

function tickLabel(value) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value);
}

export default function ForecastChart({ scenarios, seats }) {
  const container = useRef(null);
  const [width, setWidth] = useState(720);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.max(200, Math.min(720, entry.contentRect.width)));
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const height = width < 420 ? 290 : 330;
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const demands = scenarios.map((scenario) => scenario.demand);
  const dataMin = Math.min(0, seats, ...demands);
  const dataMax = Math.max(0, seats, ...demands);
  const padding = Math.max((dataMax - dataMin) * 0.08, 10);
  const minDemand = dataMin - padding;
  const maxDemand = dataMax + padding;
  const demandRange = Math.max(maxDemand - minDemand, 1);
  const x = (demand) => margin.left + ((demand - minDemand) / demandRange) * plotWidth;
  const y = (probability) => margin.top + plotHeight - (probability / 100) * plotHeight;
  const tickCount = width < 420 ? 3 : 5;
  const xTicks = Array.from({ length: tickCount }, (_, index) => minDemand + (demandRange * index) / (tickCount - 1));
  const points = scenarios.map((scenario) => ({
    ...scenario,
    probability: scenario.quantile * 100,
  }));
  const line = points.map((point, index) => {
    return (index === 0 ? 'M' : 'L') + ' ' + x(point.demand) + ' ' + y(point.probability);
  }).join(' ');
  const median = scenarios.find((scenario) => scenario.quantile === 0.5);

  return (
    <div className="chart-wrap" ref={container}>
      <div className="chart-legend" aria-hidden="true">
        <span><i className="legend-dot" /> Сценарий спроса</span>
        <span><i className="legend-seat" /> Вместимость самолёта</span>
        <span><i className="legend-median" /> Медиана</span>
      </div>
      <svg
        className="demand-chart"
        viewBox={'0 0 ' + width + ' ' + height}
        role="img"
        aria-label="График квантилей спроса с отметкой вместимости самолёта"
      >
        {xTicks.map((tick, index) => (
          <g key={'x-' + index}>
            <line
              x1={x(tick)} x2={x(tick)}
              y1={margin.top} y2={margin.top + plotHeight}
              className="chart-grid"
            />
            <text x={x(tick)} y={height - 28} textAnchor="middle" className="chart-tick">
              {tickLabel(tick)}
            </text>
          </g>
        ))}
        {[0, 25, 50, 75, 100].map((tick) => (
          <g key={'y-' + tick}>
            <line
              x1={margin.left} x2={width - margin.right}
              y1={y(tick)} y2={y(tick)}
              className="chart-grid"
            />
            <text x={margin.left - 12} y={y(tick) + 4} textAnchor="end" className="chart-tick">
              {tick}%
            </text>
          </g>
        ))}
        <line
          x1={x(seats)} x2={x(seats)}
          y1={margin.top} y2={margin.top + plotHeight}
          className="chart-seat-line"
        />
        <text x={x(seats)} y={margin.top - 10} textAnchor="middle" className="chart-seat-label">
          {'Мест: ' + tickLabel(seats)}
        </text>
        <path d={line} className="chart-demand-line" />
        {points.map((point) => (
          <circle
            key={point.quantile}
            cx={x(point.demand)}
            cy={y(point.probability)}
            r={point.quantile === 0.5 ? 7 : 4.5}
            className={point.quantile === 0.5 ? 'chart-point chart-point-median' : 'chart-point'}
          >
            <title>
              {'С вероятностью ' + quantileLabels.get(point.quantile) + ' спрос не выше ' + tickLabel(point.demand) + ' чел.'}
            </title>
          </circle>
        ))}
        <text
          x={margin.left + plotWidth / 2}
          y={height - 4}
          textAnchor="middle"
          className="chart-axis-label"
        >
          Желаемый спрос, человек
        </text>
        <text
          x={18}
          y={margin.top + plotHeight / 2}
          textAnchor="middle"
          transform={'rotate(-90 18 ' + (margin.top + plotHeight / 2) + ')'}
          className="chart-axis-label"
        >
          Вероятность спроса ≤ X
        </text>
      </svg>
      <p className="chart-note">
        Процент — вероятность того, что спрос не превысит значение по горизонтали.
        Между соседними квантилями находится около 10% вероятности.
        Продажи ограничены нулём и числом мест; отрицательный спрос — результат линейной формулы.
        {median && ' Медианный спрос: ' + tickLabel(median.demand) + ' человек.'}
      </p>
      <details className="scenario-details">
        <summary>Точные значения сценариев</summary>
        <table>
          <caption>Спрос и продажи при введённой цене</caption>
          <thead><tr><th scope="col">Квантиль</th><th scope="col">Спрос, чел.</th><th scope="col">Продажи, чел.</th></tr></thead>
          <tbody>{scenarios.map((scenario) => (
            <tr key={scenario.quantile} className={scenario.quantile === 0.5 ? 'median-row' : ''}>
              <th scope="row">{quantileLabels.get(scenario.quantile)}{scenario.quantile === 0.5 ? ' · медиана' : ''}</th>
              <td>{tickLabel(scenario.demand)}</td><td>{tickLabel(scenario.sales)}</td>
            </tr>
          ))}</tbody>
        </table>
      </details>
    </div>
  );
}
