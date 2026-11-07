import React, { useEffect, useMemo, useRef, useState } from 'react';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function parseISODate(value) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function toISODate(year, month, day) {
  return [year, String(month + 1).padStart(2, '0'), String(day).padStart(2, '0')].join('-');
}

function formatISODate(value, options) {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', ...options })
    .format(new Date(`${value}T00:00:00Z`));
}

export default function FlightDatePicker({ id, dates, value, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const availableDates = useMemo(() => new Set(dates.map((item) => item.date)), [dates]);
  const availableMonths = useMemo(
    () => [...new Set(dates.map((item) => item.date.slice(0, 7)))].sort(),
    [dates],
  );

  useEffect(() => {
    if (!dates.length) {
      setOpen(false);
      return;
    }
    const dateForMonth = availableDates.has(value) ? value : dates[0].date;
    const date = parseISODate(dateForMonth);
    setVisibleMonth(new Date(date.getFullYear(), date.getMonth(), 1));
  }, [dates, availableDates, value]);

  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
  const monthIndex = availableMonths.indexOf(monthKey);
  const days = useMemo(() => {
    const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cellCount = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
    return Array.from({ length: cellCount }, (_, index) => {
      const day = index - firstWeekday + 1;
      if (day < 1 || day > daysInMonth) return null;
      const date = toISODate(year, month, day);
      return { date, day, available: availableDates.has(date) };
    });
  }, [year, month, availableDates]);

  function moveMonth(direction) {
    const targetMonth = availableMonths[monthIndex + direction];
    if (!targetMonth) return;
    const [targetYear, targetMonthNumber] = targetMonth.split('-').map(Number);
    setVisibleMonth(new Date(targetYear, targetMonthNumber - 1, 1));
  }

  function chooseDate(date) {
    if (!availableDates.has(date)) return;
    onChange(date);
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div className="flight-date-picker" ref={rootRef}>
      <button
        id={id}
        ref={triggerRef}
        className="date-picker-trigger"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-required="true"
        aria-labelledby="date-label"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{value ? formatISODate(value, { day: 'numeric', month: 'long', year: 'numeric' }) : 'Выберите дату'}</span>
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M16 3v4M8 3v4M3 10h18" />
        </svg>
      </button>

      {open && (
        <div className="date-picker-popover" role="dialog" aria-label="Выбор даты вылета">
          <div className="date-picker-header">
            <button
              type="button"
              className="date-picker-nav"
              aria-label="Предыдущий месяц"
              disabled={monthIndex <= 0}
              onClick={() => moveMonth(-1)}
            >
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
            </button>
            <strong>{new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(visibleMonth)}</strong>
            <button
              type="button"
              className="date-picker-nav"
              aria-label="Следующий месяц"
              disabled={monthIndex < 0 || monthIndex >= availableMonths.length - 1}
              onClick={() => moveMonth(1)}
            >
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
            </button>
          </div>
          <div className="date-picker-weekdays" aria-hidden="true">
            {WEEKDAYS.map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className="date-picker-days">
            {days.map((item, index) => item ? (
              <button
                key={item.date}
                type="button"
                className={
                  'date-picker-day' +
                  (!item.available ? ' date-picker-day-unavailable' : '') +
                  (item.date === value ? ' date-picker-day-selected' : '')
                }
                aria-label={formatISODate(item.date, { day: 'numeric', month: 'long', year: 'numeric' })}
                aria-pressed={item.date === value}
                disabled={!item.available}
                onClick={() => chooseDate(item.date)}
              >
                {item.day}
              </button>
            ) : <span key={`blank-${index}`} aria-hidden="true" />)}
          </div>
          <p className="date-picker-note">Доступны только даты рейсов по выбранному маршруту</p>
        </div>
      )}
    </div>
  );
}
