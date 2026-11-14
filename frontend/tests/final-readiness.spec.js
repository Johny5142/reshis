import { test, expect } from 'playwright/test';
import { randomUUID } from 'node:crypto';

test.beforeEach(async ({ page }) => {
  const response = await page.request.post('/api/auth/register', {
    data: { email: randomUUID() + '@example.com', password: randomUUID() },
    headers: { 'X-Requested-With': 'reshis' },
  });
  expect(response.status()).toBe(201);
});

async function chooseRoute(page, code) {
  await page.getByRole('button', { name: 'Маршрут', exact: true }).click();
  await page.getByRole('option').filter({ hasText: code }).getByRole('button').click();
  await expect(page.getByRole('button', { name: 'Дата вылета' })).toBeEnabled();
}

for (const theme of ['Светлая тема', 'Тёмная тема']) {
  test('raw chart preserves linear median in ' + theme, async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: theme, exact: true }).click();
    await chooseRoute(page, 'MOW-KGD');
    await page.getByRole('button', { name: 'Дата вылета' }).click();
    await page.getByRole('dialog').getByRole('button', { name: '19 июня 2026 г.', exact: true }).click();
    await page.getByLabel('Цена билета').fill('14000');
    const pending = page.waitForResponse(r => r.url().endsWith('/api/forecast') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Рассчитать прогноз' }).click();
    const result = await (await pending).json();
    await expect(page.locator('.distribution-summary strong').last()).toHaveText('0 чел.');
    await page.getByRole('button', { name: 'Исходный расчёт модели', exact: true }).click();
    const format = value => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value);
    await expect(page.locator('.distribution-summary strong').last()).toHaveText(format(result.median_demand) + ' чел.');
    await expect(page.locator('.chart-point-median title')).toContainText(format(result.median_demand));
    expect(await page.locator('.chart-tick').allTextContents()).toContain('-500');
    await expect(page.locator('.chart-seat-label')).toHaveText('Мест: 450');
    await page.getByRole('button', { name: 'Квантиль 10%', exact: true }).click();
    await expect(page.locator('.scenario-readout strong')).toHaveText(format(result.scenarios[0].demand));
    await page.getByRole('button', { name: 'Спрос покупателей', exact: true }).click();
    await expect(page.locator('.scenario-readout strong')).toHaveText('0 чел.');
  });
}

test('stale history cannot overwrite history after a new calculation', async ({ page }) => {
  const held = [];
  let hold = true;
  let completed = 0;
  await page.route('**/api/forecast/history', async route => {
    const response = await route.fetch();
    const wasHeld = hold;
    if (wasHeld) await new Promise(resolve => held.push(resolve));
    await route.fulfill({ response });
    if (wasHeld) completed += 1;
  });
  await page.goto('/');
  await expect.poll(() => held.length).toBeGreaterThan(0);
  await chooseRoute(page, 'MOW-AER');
  await page.getByLabel('Цена билета').fill('9000.49');
  hold = false;
  await page.getByRole('button', { name: 'Рассчитать прогноз' }).click();
  await expect(page.locator('.history-item')).toHaveCount(1);
  for (const release of held) release();
  await expect.poll(() => completed).toBe(held.length);
  await expect(page.locator('.history-item')).toHaveCount(1);
  await page.locator('.history-item').click();
  await expect(page.getByLabel('Цена билета')).toHaveValue('9000.49');
});

test('fractional price is preserved in request, result, chart and history', async ({ page }) => {
  await page.goto('/');
  await chooseRoute(page, 'MOW-AER');
  for (const price of [9000.49, 9000.1234]) {
    await page.getByLabel('Цена билета').fill(String(price));
    const pending = page.waitForResponse(r => r.url().endsWith('/api/forecast') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Рассчитать прогноз' }).click();
    const response = await pending;
    expect(response.request().postDataJSON().price).toBe(price);
    expect((await response.json()).price).toBe(price);
    const formatted = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: 0, maximumFractionDigits: 20 }).format(price);
    await expect(page.locator('.results-heading')).toContainText(formatted);
    await expect(page.locator('.chart-heading')).toContainText(formatted);
    await expect(page.locator('.metric-card-accent')).toContainText(formatted);
    await expect(page.locator('.history-item').first()).toContainText(formatted);
  }
  await page.reload();
  await page.locator('.history-item').first().click();
  await expect(page.getByLabel('Цена билета')).toHaveValue('9000.1234');
});
