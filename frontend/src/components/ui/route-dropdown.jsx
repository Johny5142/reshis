import React, { useEffect, useRef, useState } from 'react';

function Chevron({ open }) {
  return (
    <svg className={'route-dropdown-chevron' + (open ? ' is-open' : '')} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="m5 7.5 5 5 5-5" />
    </svg>
  );
}

export default function RouteDropdown({ routes, value, onChange, disabled = false }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const selected = routes.find((route) => route.route === value);

  useEffect(() => {
    function closeOnOutsideClick(event) {
      if (!root.current?.contains(event.target)) setOpen(false);
    }
    function closeOnEscape(event) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  function choose(route) {
    setOpen(false);
    if (route.route !== value) onChange(route.route);
  }

  return (
    <div className="route-dropdown" ref={root}>
      <button
        aria-label="Маршрут"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls="route-options"
        className="route-dropdown-trigger"
        type="button"
        disabled={disabled || routes.length === 0}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="route-dropdown-current">
          <span className="route-dropdown-code">{selected?.route || 'Выберите маршрут'}</span>
          <span className="route-dropdown-cities">
            {selected ? `${selected.origin} → ${selected.destination}` : 'Направление рейса'}
          </span>
        </span>
        <Chevron open={open} />
      </button>
      <div className={'route-dropdown-menu' + (open ? ' is-open' : '')}>
        <div className="route-dropdown-menu-heading">Направления · {routes.length}</div>
        <ul id="route-options" role="listbox" aria-label="Доступные маршруты">
          {routes.map((route, index) => (
            <li key={route.route} role="option" aria-selected={route.route === value} style={{ '--route-order': index }}>
              <button type="button" tabIndex={open ? 0 : -1} onClick={() => choose(route)}>
                <span className="route-option-main">
                  <span className="route-option-cities">{route.origin}<i>→</i>{route.destination}</span>
                  <span className="route-option-code">{route.route}</span>
                </span>
                <span className="route-option-meta">
                  <span>от {new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(route.price_min)} ₽</span>
                  {route.route === value && <span className="route-option-selected" aria-label="Выбран">✓</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
