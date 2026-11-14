import { test, expect } from 'playwright/test';
import { randomUUID } from 'node:crypto';

for (const legacy of [false, true]) {
test('customer demand stays consistent across cards, graph, table and restored history: ' + (legacy ? 'legacy API' : 'current API'), async ({ page }, testInfo) => {
  if (legacy) {
    const removeNewFields = (forecast) => {
      delete forecast.median_customer_demand;
      forecast.scenarios.forEach((scenario) => { delete scenario.customer_demand; });
      return forecast;
    };
    await page.route('**/api/forecast{,/history}', async (route) => {
      const response = await route.fetch();
      const payload = await response.json();
      if (Array.isArray(payload)) payload.forEach((item) => removeNewFields(item.forecast));
      else removeNewFields(payload);
      await route.fulfill({ response, json: payload });
    });
  }
  await page.request.post('/api/auth/register', {
    data: { email: randomUUID() + '@example.com', password: randomUUID() },
    headers: { 'X-Requested-With': 'reshis' },
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Маршрут', exact: true }).click();
  await page.getByRole('option').filter({ hasText: 'MOW-KGD' }).getByRole('button').click();
  await page.getByRole('button', { name: 'Дата вылета' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '19 июня 2026 г.', exact: true }).click();
  const format = (value) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value);

  for (const price of [0, 7500, 10000, 12000, 14000, 14500, 20000]) {
    await page.getByLabel('Цена билета').fill(String(price));
    const pending = page.waitForResponse((response) => response.url().endsWith('/api/forecast') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Рассчитать прогноз' }).click();
    const response = await pending;
    expect(response.status()).toBe(200);
    const result = await response.json();
    if (legacy) {
      expect(result).not.toHaveProperty('median_customer_demand');
      expect(result.scenarios[0]).not.toHaveProperty('customer_demand');
    }
    const expected = result.scenarios.map((item) => Math.max(0, item.demand));
    await expect(page.locator('.metric-card strong').first()).toHaveText(format(Math.max(0, result.median_demand)) + ' чел.');
    await expect(page.locator('.metric-card-accent strong')).toHaveText(format(result.median_sales) + ' чел.');
    await expect(page.locator('.distribution-summary strong').first()).toHaveText(format(expected[0]) + ' – ' + format(expected[8]) + ' чел.');
    if (result.median_demand <= 0) await expect(page.locator('.zero-demand-note')).toBeVisible();
    else await expect(page.locator('.zero-demand-note')).toHaveCount(0);
    if (expected.every((value) => value === 0)) {
      await expect(page.locator('.zero-demand-note')).toContainText('Все сценарии');
      const heights = await page.locator('.chart-point').evaluateAll((points) => points.map((point) => point.getAttribute('cy')));
      expect(new Set(heights).size).toBe(1);
    }
    const ticks = await page.locator('.chart-tick').allTextContents();
    expect(ticks.some((tick) => tick.includes('−') || tick.includes('-'))).toBe(false);
    await page.getByText('Точные значения сценариев', { exact: true }).click();
    for (let index = 0; index < 9; index++) {
      const row = page.locator('.scenario-details').first().locator('tbody tr').nth(index);
      await expect(row.locator('td').first()).toHaveText(format(expected[index]));
      await page.getByRole('button', { name: 'Квантиль ' + (index + 1) * 10 + '%', exact: true }).click();
      await expect(page.locator('.scenario-readout strong')).toHaveText(format(expected[index]) + ' чел.');
      await expect(page.locator('.chart-point title').nth(index)).toContainText(format(expected[index]) + ' чел.');
    }
    await page.getByText('Подробности расчёта', { exact: true }).click();
    await expect(page.locator('.calculation-details')).toContainText('Медиана исходного расчёта: ' + new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(result.median_demand));
    await expect(page.locator('.calculation-details tbody tr').first().locator('td')).toHaveText(new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(result.scenarios[0].demand));
    if (price === 14000 || price === 20000) {
      await page.locator('.chart-card').screenshot({ path: testInfo.outputPath('demand-' + price + '.png') });
    }
  }

  await page.reload();
  await page.locator('.history-item').filter({ hasText: '20 000' }).first().click();
  await expect(page.locator('.metric-card strong').first()).toHaveText('0 чел.');
  await expect(page.locator('.distribution-summary strong').first()).toHaveText('0 – 0 чел.');
});
}
