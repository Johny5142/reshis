// Raw linear demand is the source for both current and pre-upgrade API responses.
export function normalizeForecast(forecast) {
  if (!forecast || !Number.isFinite(forecast.median_demand)
      || !Number.isFinite(forecast.median_sales) || !Number.isFinite(forecast.seats)
      || !Array.isArray(forecast.scenarios) || forecast.scenarios.length !== 9) {
    throw new Error('Сервер вернул некорректный прогноз. Повторите расчёт.');
  }
  const scenarios = forecast.scenarios.map((scenario) => {
    if (!scenario || !Number.isFinite(scenario.demand) || !Number.isFinite(scenario.sales)
        || !Number.isFinite(scenario.quantile)) {
      throw new Error('Сервер вернул некорректный сценарий спроса. Повторите расчёт.');
    }
    return { ...scenario, customer_demand: Math.max(0, scenario.demand) };
  });
  return {
    ...forecast,
    median_customer_demand: Math.max(0, forecast.median_demand),
    scenarios,
  };
}
