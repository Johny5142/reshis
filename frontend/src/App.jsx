import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import ForecastChart from './ForecastChart.jsx';
import GradientWave from './GradientWave.jsx';
import AnimatedGradient from './AnimatedGradient.jsx';

function formatCount(value) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value);
}

function formatPrice(value) {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0,
  }).format(value);
}

function PlaneMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 40 40" fill="none">
        <path
          d="M20 4.5 23.2 17l10.4 6.1c1.6.9 1 3.3-.8 3.4l-9.6-.8-1.8 7.2a1.4 1.4 0 0 1-2.8 0l-1.8-7.2-9.6.8c-1.8-.1-2.4-2.5-.8-3.4L16.8 17 20 4.5Z"
          fill="currentColor"
        />
      </svg>
    </span>
  );
}

function ThemeToggle({ theme, onToggle, compact = false }) {
  const nextTheme = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      className={'theme-toggle' + (compact ? ' theme-toggle-compact' : '')}
      type="button"
      onClick={onToggle}
      aria-label={nextTheme === 'dark' ? 'Включить тёмную тему' : 'Включить светлую тему'}
      aria-pressed={theme === 'dark'}
      title={nextTheme === 'dark' ? 'Включить тёмную тему' : 'Включить светлую тему'}
    >
      <span className="theme-toggle-icon" aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
      <span className="theme-toggle-label">{theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}</span>
    </button>
  );
}

function AuthForm({ onAuthenticated, initialError, theme, onToggleTheme }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState(initialError || '');
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const isRegister = mode === 'register';
  const passwordsMatch = !isRegister || !confirmPassword || password === confirmPassword;

  useEffect(() => setError(initialError || ''), [initialError]);

  async function submit(event) {
    event.preventDefault();
    setError('');
    if (isRegister && password !== confirmPassword) {
      setError('Пароли не совпадают. Проверьте подтверждение пароля.');
      return;
    }
    setBusy(true);
    try {
      const path = isRegister ? '/auth/register' : '/auth/login';
      const user = await api(path, {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setLeaving(true);
      window.setTimeout(() => onAuthenticated(user), 260);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={'auth-layout' + (leaving ? ' auth-leaving' : '')}>
      <section className="auth-story">
        <GradientWave />
        <div className="brand-lockup">
          <PlaneMark />
          <span>РЕШИСЬ <b>АВИА</b></span>
        </div>
        <div className="story-copy">
          <h1>Пусть каждый рейс летит с полной отдачей.</h1>
          <p>
            Сравнивайте сценарии спроса, проверяйте загрузку и находите цену для каждого
            направления.
          </p>
        </div>
        <div className="story-foot">
          <span className="status-orb" />
          Прогнозы на основе сезонных данных
        </div>
      </section>
      <section className="auth-panel">
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        <div className="auth-card">
          <div className="auth-card-top">
            {isRegister && <span className="mini-label">НОВЫЙ АККАУНТ</span>}
            <span className="auth-step">{isRegister ? '01 / 01' : 'ВХОД'}</span>
          </div>
          <h2>{isRegister ? 'Создать аккаунт' : 'С возвращением'}</h2>
          <p className="auth-subtitle">
            {isRegister
              ? 'Зарегистрируйтесь, чтобы открыть прогнозы Решись Авиа.'
              : 'Войдите, чтобы продолжить работу с прогнозом продаж.'}
          </p>
          <form onSubmit={submit} className="auth-form">
            <label>
              <span>Электронная почта</span>
              <input
                autoComplete="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@example.com"
                required
              />
            </label>
            <label>
              <span>Пароль</span>
              <input
                autoComplete={isRegister ? 'new-password' : 'current-password'}
                type="password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setError('');
                }}
                placeholder={isRegister ? 'Не менее 8 символов' : 'Введите пароль'}
                minLength={isRegister ? 8 : undefined}
                maxLength={128}
                required
              />
            </label>
            {isRegister && (
              <label>
                <span>Подтвердите пароль</span>
                <input
                  autoComplete="new-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => {
                    setConfirmPassword(event.target.value);
                    setError('');
                  }}
                  placeholder="Повторите пароль"
                  minLength={8}
                  maxLength={128}
                  aria-invalid={!passwordsMatch}
                  aria-describedby={!passwordsMatch ? 'confirm-password-error' : undefined}
                  required
                />
                {!passwordsMatch && (
                  <small id="confirm-password-error" className="password-mismatch" role="alert">
                    Пароли не совпадают
                  </small>
                )}
              </label>
            )}
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="button button-primary auth-submit" type="submit" disabled={busy}>
              {busy ? 'Проверяем…' : isRegister ? 'Создать аккаунт' : 'Войти в систему'}
              {!busy && <span aria-hidden="true">↗</span>}
            </button>
          </form>
          <div className="auth-switch">
            {isRegister ? 'Уже зарегистрированы?' : 'Впервые здесь?'}
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setError('');
                setConfirmPassword('');
                setMode(isRegister ? 'login' : 'register');
              }}
            >
              {isRegister ? 'Войти' : 'Создать аккаунт'}
            </button>
          </div>
          <p className="privacy-note">
            Пароль хранится в защищённом виде. Email нужен только для входа.
          </p>
        </div>
        <footer className="auth-footer">Решись Авиа <span>·</span> Аналитика полётов</footer>
      </section>
    </main>
  );
}

function MetricCard({ label, value, supporting, accent }) {
  return (
    <article className={'metric-card ' + (accent ? 'metric-card-accent' : '')}>
      <span className="metric-label">{label}</span>
      <strong>{value}</strong>
      <span className="metric-supporting">{supporting}</span>
    </article>
  );
}

function Dashboard({ user, onLogout, onSessionExpired, theme, onToggleTheme, animateEntrance }) {
  const [routes, setRoutes] = useState([]);
  const [routeCode, setRouteCode] = useState('');
  const [dates, setDates] = useState([]);
  const [flightDate, setFlightDate] = useState('');
  const [price, setPrice] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loadingRoutes, setLoadingRoutes] = useState(true);
  const [loadingDates, setLoadingDates] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState('');
  const [activeHistoryId, setActiveHistoryId] = useState(null);
  const forecastRequest = useRef(null);
  const pendingHistoryRef = useRef(null);
  const reportError = useCallback((requestError) => {
    if (requestError.status === 401) onSessionExpired();
    else setError(requestError.message);
  }, [onSessionExpired]);

  const refreshHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const items = await api('/forecast/history');
      setHistory(items);
    } catch (requestError) {
      if (requestError.status === 401) onSessionExpired();
      else setHistoryError(requestError.message);
    } finally {
      setHistoryLoading(false);
    }
  }, [onSessionExpired]);

  useEffect(() => () => forecastRequest.current?.abort(), []);

  useEffect(() => {
    refreshHistory();
  }, [refreshHistory]);

  function invalidateForecast() {
    forecastRequest.current?.abort();
    forecastRequest.current = null;
    pendingHistoryRef.current = null;
    setCalculating(false);
    setResult(null);
    setActiveHistoryId(null);
    setError('');
  }

  useEffect(() => {
    let cancelled = false;
    api('/routes')
      .then((items) => {
        if (cancelled) return;
        setRoutes(items);
        if (items.length) {
          setRouteCode(items[0].route);
          setPrice(String(items[0].base_price));
        }
      })
      .catch((requestError) => {
        if (!cancelled) reportError(requestError);
      })
      .finally(() => {
        if (!cancelled) setLoadingRoutes(false);
      });
    return () => { cancelled = true; };
  }, [reportError]);

  useEffect(() => {
    if (!routeCode) return undefined;
    let cancelled = false;
    setLoadingDates(true);
    setDates([]);
    setFlightDate('');
    setResult(null);
    setError('');
    api('/routes/' + encodeURIComponent(routeCode) + '/dates')
      .then((items) => {
        if (cancelled) return;
        setDates(items);
        const pendingHistory = pendingHistoryRef.current;
        const pendingDate = pendingHistory?.route === routeCode
          ? items.find((item) => item.date === pendingHistory.date)
          : null;
        if (pendingDate && pendingHistory) {
          setFlightDate(pendingDate.date);
          setPrice(String(pendingHistory.price));
          setResult(pendingHistory.forecast);
          setActiveHistoryId(pendingHistory.id);
          pendingHistoryRef.current = null;
        } else if (items.length) {
          setFlightDate(items[0].date);
        }
      })
      .catch((requestError) => {
        if (!cancelled) reportError(requestError);
      })
      .finally(() => {
        if (!cancelled) setLoadingDates(false);
      });
    return () => { cancelled = true; };
  }, [routeCode, reportError]);

  const selectedRoute = useMemo(
    () => routes.find((item) => item.route === routeCode),
    [routes, routeCode],
  );
  const selectedDate = dates.find((item) => item.date === flightDate);
  const priceValue = Number(price);
  const priceIsValid = price.trim() !== '' && Number.isFinite(priceValue) && priceValue >= 0;
  const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
  const historyFlightFormatter = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
  const historyCreatedFormatter = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
  const dateRange = dates.length
    ? dateFormatter.formatRange(
      new Date(dates[0].date + 'T00:00:00Z'),
      new Date(dates[dates.length - 1].date + 'T00:00:00Z'),
    )
    : 'Загрузка дат…';

  function changeRoute(event) {
    invalidateForecast();
    setDates([]);
    setFlightDate('');
    const nextCode = event.target.value;
    setRouteCode(nextCode);
    const nextRoute = routes.find((item) => item.route === nextCode);
    setPrice(nextRoute ? String(nextRoute.base_price) : '');
  }

  function openHistory(item) {
    invalidateForecast();
    if (item.route === routeCode && dates.some((entry) => entry.date === item.date)) {
      setFlightDate(item.date);
      setPrice(String(item.price));
      setResult(item.forecast);
      setActiveHistoryId(item.id);
      return;
    }

    pendingHistoryRef.current = item;
    setDates([]);
    setFlightDate('');
    setPrice(String(item.price));
    setRouteCode(item.route);
    setActiveHistoryId(item.id);
  }

  async function submitForecast(event) {
    event.preventDefault();
    if (!priceIsValid || !selectedDate || loadingDates || calculating) return;
    invalidateForecast();
    const controller = new AbortController();
    forecastRequest.current = controller;
    setCalculating(true);
    try {
      const forecast = await api('/forecast', {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify({ route: routeCode, date: flightDate, price: priceValue }),
      });
      if (!controller.signal.aborted) {
        setResult(forecast);
        setActiveHistoryId(null);
        refreshHistory();
      }
    } catch (requestError) {
      if (!controller.signal.aborted) reportError(requestError);
    } finally {
      if (!controller.signal.aborted) {
        setCalculating(false);
        forecastRequest.current = null;
      }
    }
  }

  async function logout() {
    try {
      await onLogout();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  return (
    <div className={'app-shell' + (animateEntrance ? ' dashboard-enter' : '')}>
      <AnimatedGradient />
      <header className="topbar">
        <a className="brand-lockup brand-lockup-dark" href="/" aria-label="Решись Авиа — главная">
          <PlaneMark />
          <span>РЕШИСЬ <b>АВИА</b></span>
        </a>
        <div className="topbar-right">
          <span className="live-status"><i /> Прогнозный центр</span>
          <ThemeToggle theme={theme} onToggle={onToggleTheme} compact />
          <span className="user-chip" title={user.email}>{user.email}</span>
          <button className="button button-quiet" type="button" onClick={logout}>Выйти</button>
        </div>
      </header>

      <main className="dashboard">
        <section className="page-heading">
          <div>
            <p className="eyebrow eyebrow-dark">АНАЛИТИКА РЕЙСОВ <span> / </span> ПРОГНОЗ</p>
            <h1>Спрос на вашем маршруте</h1>
            <p className="page-intro">
              Задайте цену и оцените, сколько пассажиров выберут рейс в разных сценариях.
            </p>
          </div>
          <div className="date-range-badge">
            <span className="badge-label">ДАТЫ МАРШРУТА</span>
            <strong>{dateRange}</strong>
          </div>
        </section>

        <section className="workspace-grid">
          <aside className="control-panel">
            <div className="panel-heading">
              <span className="panel-index">01</span>
              <div>
                <h2>Параметры рейса</h2>
                <p>Выберите направление и дату</p>
              </div>
            </div>
            {loadingRoutes ? (
              <div className="loading-state">Загружаем маршруты…</div>
            ) : (
              <form className="forecast-form" onSubmit={submitForecast}>
                <label>
                  <span id="route-label">Маршрут</span>
                  <select aria-labelledby="route-label" value={routeCode} onChange={changeRoute} required>
                    {routes.map((item) => (
                      <option key={item.route} value={item.route}>
                        {item.origin} → {item.destination}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span id="date-label">Дата вылета</span>
                  <select
                    aria-labelledby="date-label"
                    value={flightDate}
                    onChange={(event) => {
                      invalidateForecast();
                      setFlightDate(event.target.value);
                    }}
                    disabled={loadingDates || !dates.length}
                    required
                  >
                    {dates.map((item) => (
                      <option key={item.date} value={item.date}>
                        {new Intl.DateTimeFormat('ru-RU', {
                          day: 'numeric',
                          month: 'long',
                          year: 'numeric',
                          timeZone: 'UTC',
                        }).format(new Date(item.date + 'T00:00:00Z'))}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span id="price-label">Цена билета</span>
                  <div className="price-input-wrap">
                    <input
                      aria-labelledby="price-label"
                      aria-describedby={selectedRoute ? 'price-hint' : undefined}
                      type="number"
                      min="0"
                      step="any"
                      value={price}
                      onChange={(event) => {
                        invalidateForecast();
                        setPrice(event.target.value);
                      }}
                      placeholder="Например, 9 000"
                      required
                    />
                    <span>₽</span>
                  </div>
                  {selectedRoute && (
                    <small id="price-hint" className="field-hint">
                      Ориентир: {formatPrice(selectedRoute.price_min)}–{formatPrice(selectedRoute.price_max)}
                    </small>
                  )}
                </label>
                {error && <p className="form-error" role="alert">{error}</p>}
                <button
                  className="button button-primary calculate-button"
                  type="submit"
                  disabled={
                    calculating ||
                    loadingDates ||
                    !routeCode ||
                    !flightDate ||
                    !priceIsValid ||
                    !selectedDate
                  }
                >
                  {calculating ? 'Считаем прогноз…' : 'Рассчитать прогноз'}
                  {!calculating && <span aria-hidden="true">→</span>}
                </button>
                <p className="form-footnote">
                  Расчёт использует девять сценариев спроса для выбранной даты.
                </p>
              </form>
            )}
            {selectedDate && (
              <div className="flight-capacity">
                <span className="capacity-icon" aria-hidden="true">⌁</span>
                <span>
                  <b>{formatCount(selectedDate.seats)} мест</b>
                  <small>Вместимость на рейсе</small>
                </span>
              </div>
            )}
          </aside>

          <section className={'results-panel ' + (result ? 'results-panel-ready' : '')} aria-live="polite" aria-busy={calculating}>
            {!result ? (
              <div className="empty-state">
                <div className="empty-visual" aria-hidden="true">
                  <span className="empty-ring empty-ring-one" />
                  <span className="empty-ring empty-ring-two" />
                  <span className="empty-plane">✈</span>
                  <span className="empty-route-line" />
                </div>
                <p className="mini-label">ОЖИДАЕТСЯ РАСЧЁТ</p>
                <h2>Прогноз появится здесь</h2>
                <p>Выберите рейс и задайте цену — покажем ожидаемые продажи и распределение спроса.</p>
              </div>
            ) : (
              <>
                <div className="results-heading">
                  <div>
                    <p className="mini-label">02 / РЕЗУЛЬТАТ ПРОГНОЗА</p>
                    <h2>{selectedRoute?.origin} <span>→</span> {selectedRoute?.destination}</h2>
                    <p>
                      {new Intl.DateTimeFormat('ru-RU', {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                        timeZone: 'UTC',
                      }).format(new Date(result.date + 'T00:00:00Z'))}
                      <span className="result-divider">·</span>
                      Цена {formatPrice(result.price)}
                    </p>
                  </div>
                  <span className="result-pill"><i /> РАСЧЁТ ГОТОВ</span>
                </div>
                <div className="metrics-grid">
                  <MetricCard
                    label="Медианный спрос"
                    value={formatCount(result.median_demand) + ' чел.'}
                    supporting={result.median_demand < 0 ? 'Линейная оценка ниже нуля · продаж нет' : 'Сценарий 0.5 · хотят купить'}
                  />
                  <MetricCard
                    label="Прогноз продаж"
                    value={formatCount(result.median_sales) + ' чел.'}
                    supporting={'При цене ' + formatPrice(result.price)}
                    accent
                  />
                  <MetricCard
                    label="Мест в самолёте"
                    value={formatCount(result.seats) + ' мест'}
                    supporting={
                      result.median_demand > result.seats
                        ? 'Спрос выше вместимости'
                        : 'Вместимость покрывает медиану'
                    }
                  />
                </div>
                <section className="chart-card">
                  <div className="chart-heading">
                    <div>
                      <p className="mini-label">СЦЕНАРИИ СПРОСА</p>
                      <h3>Как может измениться загрузка</h3>
                    </div>
                    <span className="scenario-count">9 квантилей</span>
                  </div>
                  <ForecastChart scenarios={result.scenarios} seats={result.seats} />
                </section>
              </>
            )}
          </section>
        </section>
        <section className="history-panel" aria-labelledby="history-title">
          <div className="history-heading">
            <div>
              <p className="mini-label">СОХРАНЁННЫЕ РАСЧЁТЫ</p>
              <h2 id="history-title">История поиска</h2>
            </div>
            {!historyLoading && history.length > 0 && (
              <span className="scenario-count">{history.length} записей</span>
            )}
          </div>
          {historyLoading ? (
            <p className="history-empty">Загружаем историю…</p>
          ) : historyError ? (
            <p className="history-error" role="alert">{historyError}</p>
          ) : history.length === 0 ? (
            <p className="history-empty">Здесь появятся ваши маршруты, даты и цены после расчёта прогноза.</p>
          ) : (
            <div className="history-list">
              {history.map((item) => {
                const route = routes.find((entry) => entry.route === item.route);
                const routeLabel = route
                  ? route.origin + ' → ' + route.destination
                  : item.route;
                return (
                  <button
                    className={'history-item' + (activeHistoryId === item.id ? ' history-item-active' : '')}
                    type="button"
                    key={item.id}
                    aria-pressed={activeHistoryId === item.id}
                    onClick={() => openHistory(item)}
                  >
                    <span className="history-item-top">
                      <strong>{routeLabel}</strong>
                      <small>{historyCreatedFormatter.format(new Date(item.created_at))}</small>
                    </span>
                    <span className="history-item-details">
                      <span>{historyFlightFormatter.format(new Date(item.date + 'T00:00:00Z'))}</span>
                      <b>{formatPrice(item.price)}</b>
                    </span>
                    <span className="history-item-summary">
                      Продажи: {formatCount(item.median_sales)} из {formatCount(item.seats)} мест
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
        <footer className="page-footer">
          <span>Решись Авиа <b>·</b> Инструмент планирования продаж</span>
          <span>Оценка спроса по сезонному прогнозу</span>
        </footer>
      </main>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [bootError, setBootError] = useState('');
  const [animateDashboard, setAnimateDashboard] = useState(false);
  const [theme, setTheme] = useState(() => {
    try {
      return window.localStorage.getItem('reshis-theme') === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });
  const toggleTheme = useCallback(() => {
    setTheme((currentTheme) => currentTheme === 'dark' ? 'light' : 'dark');
  }, []);
  const sessionExpired = useCallback(() => {
    setUser(null);
    setBootError('Сессия истекла. Войдите снова, чтобы продолжить.');
  }, []);

  useEffect(() => {
    let cancelled = false;
    api('/auth/me')
      .then((account) => {
        if (!cancelled) setUser(account);
      })
      .catch((requestError) => {
        if (!cancelled && requestError.status !== 401) setBootError(requestError.message);
      })
      .finally(() => {
        if (!cancelled) setAuthReady(true);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem('reshis-theme', theme);
    } catch {
      // Theme still works for this session when storage is unavailable.
    }
  }, [theme]);

  async function logout() {
    await api('/auth/logout', { method: 'POST' });
    setUser(null);
    setBootError('');
    setAnimateDashboard(false);
  }

  function handleAuthenticated(account) {
    setAnimateDashboard(true);
    setUser(account);
  }

  let screen;
  if (!authReady) {
    screen = (
      <div className="boot-screen">
        <div className="boot-spinner" />
        <span>Открываем рабочее пространство…</span>
      </div>
    );
  } else if (!user) {
    screen = (
      <AuthForm
        onAuthenticated={handleAuthenticated}
        initialError={bootError}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
    );
  } else {
    screen = (
      <Dashboard
        user={user}
        onLogout={logout}
        onSessionExpired={sessionExpired}
        theme={theme}
        onToggleTheme={toggleTheme}
        animateEntrance={animateDashboard}
      />
    );
  }

  return <div className="app-root" data-theme={theme}>{screen}</div>;
}
