import { test, expect } from 'playwright/test';

async function register(page) {
  const email = `browser-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  const password = '  browser-password  ';
  await page.goto('/');
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
  await page.getByLabel('Электронная почта').fill(email);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Спрос на вашем маршруте' })).toBeVisible();
  await page.getByLabel('Маршрут', { exact: true }).selectOption('MOW-AER');
  await expect(page.getByLabel('Дата вылета')).toHaveValue('2026-06-01');
  return { email, password };
}

test('registration, exact password, median, limits, session expiry and logout', async ({ page, context }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const credentials = await register(page);
  const calculate = page.getByRole('button', { name: 'Рассчитать прогноз' });
  await calculate.click();
  await expect(page.locator('.metric-card strong')).toHaveText(['775 чел.', '775 чел.', '900 мест']);
  await expect(page.locator('.chart-point')).toHaveCount(9);
  await expect(page.locator('.chart-point-median title')).toContainText('775');
  await expect(page.locator('.chart-seat-label')).toHaveText('Мест: 900');
  await page.getByText('Точные значения сценариев', { exact: true }).click();
  await expect(page.locator('.median-row')).toHaveText(/50% · медиана775775/);
  // Fractional demand must use the same precision in the chart and the cards.
  await page.getByLabel('Цена билета').fill('9001');
  await calculate.click();
  await expect(page.locator('.metric-card strong').first()).toHaveText('774,9 чел.');
  await expect(page.locator('.chart-point-median title')).toContainText('774,9');
  for (const [price, sales] of [['0', '900 чел.'], ['10000000', '0 чел.']]) {
    await page.getByLabel('Цена билета').fill(price);
    await calculate.click();
    await expect(page.locator('.metric-card-accent strong')).toHaveText(sales);
  }
  await page.getByLabel('Цена билета').fill('');
  await expect(calculate).toBeDisabled();
  await page.getByLabel('Цена билета').fill('9000');
  await context.clearCookies();
  await calculate.click();
  await expect(page.getByRole('alert')).toContainText('Сессия истекла');
  await page.getByLabel('Электронная почта').fill(credentials.email);
  await page.getByLabel('Пароль', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'Войти в систему' }).click();
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'С возвращением' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'С возвращением' })).toBeVisible();
  expect(errors).toEqual([]);
});

for (const field of ['price', 'date', 'route']) {
  test(`a delayed forecast cannot restore results after changing ${field}`, async ({ page }) => {
    await register(page);
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let requested;
    const started = new Promise((resolve) => { requested = resolve; });
    let finished;
    const completed = new Promise((resolve) => { finished = resolve; });
    await page.route('**/api/forecast', async (route) => {
      const response = await route.fetch();
      requested();
      await gate;
      try { await route.fulfill({ response }); } finally { finished(); }
    }, { times: 1 });
    await page.getByRole('button', { name: 'Рассчитать прогноз' }).click();
    await started;
    if (field === 'price') await page.getByLabel('Цена билета').fill('10000');
    if (field === 'date') await page.getByLabel('Дата вылета').selectOption('2026-06-02');
    if (field === 'route') await page.getByLabel('Маршрут', { exact: true }).selectOption('MOW-LED');
    release();
    await completed;
    await page.waitForTimeout(100);
    await expect(page.getByRole('heading', { name: 'Прогноз появится здесь' })).toBeVisible();
    await expect(page.locator('.metrics-grid')).toHaveCount(0);
    await page.getByRole('button', { name: 'Рассчитать прогноз' }).click();
    await expect(page.locator('.metrics-grid')).toBeVisible();
  });
}

test('desktop and narrow mobile layouts keep all controls and results visible', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await register(page);
  await page.getByRole('button', { name: 'Рассчитать прогноз' }).click();
  await expect(page.locator('.chart-point-median')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('desktop.png'), fullPage: true });
  for (const width of [375, 320]) {
    await page.setViewportSize({ width, height: 850 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.getByRole('button', { name: 'Выйти', exact: true })).toBeInViewport();
    const overflow = await page.evaluate(() => [...document.querySelectorAll('body *')]
      .filter((element) => element.getBoundingClientRect().right > window.innerWidth)
      .map((element) => ({ tag: element.tagName, className: element.getAttribute('class'), right: element.getBoundingClientRect().right })));
    expect(overflow).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByText('Точные значения сценариев', { exact: true }).click();
    await expect(page.locator('.median-row')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`mobile-${width}.png`), fullPage: true });
    await page.getByText('Точные значения сценариев', { exact: true }).click();
  }
});
