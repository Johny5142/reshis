import { test, expect } from 'playwright/test';
import { randomUUID } from 'node:crypto';

test.use({ trace: 'off' });

for (const theme of ['Светлая тема', 'Тёмная тема']) {
  test('auth design and accessibility in ' + theme, async ({ page }, testInfo) => {
    await page.goto('/');
    await page.getByRole('button', { name: theme, exact: true }).click();
    const password = page.getByLabel('Пароль', { exact: true });
    await password.fill('sample-password');
    await page.getByRole('button', { name: 'Показать пароль', exact: true }).focus();
    await page.keyboard.press('Space');
    await expect(password).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: 'Скрыть пароль', exact: true }).click();
    await expect(password).toHaveAttribute('type', 'password');

    for (const width of [1440, 900, 375, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const mode of ['login', 'register']) {
        if (mode === 'register') {
          await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
          await expect(page.getByRole('heading', { name: 'Создайте аккаунт' })).toBeVisible();
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await expect(page.getByLabel('Электронная почта')).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath(mode + '-' + width + '.png'), fullPage: true });
        if (mode === 'register') await page.getByRole('button', { name: 'Войти', exact: true }).click();
      }
    }

    await page.setViewportSize({ width: 1440, height: 1000 });
    const credentials = { email: randomUUID() + '@example.com', password: randomUUID() };
    const response = await page.request.post('/api/auth/register', {
      data: credentials, headers: { 'X-Requested-With': 'reshis' },
    });
    expect(response.status()).toBe(201);
    await page.context().clearCookies();
    await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
    await page.getByLabel('Электронная почта').fill(credentials.email);
    await password.fill(credentials.password);
    const confirm = page.getByLabel('Подтвердите пароль', { exact: true });
    const submit = page.getByRole('button', { name: 'Создать аккаунт', exact: true });
    const beforeMismatch = await submit.boundingBox();
    await confirm.fill('different-password');
    await expect(page.getByRole('alert')).toHaveText('Пароли не совпадают');
    expect((await submit.boundingBox()).y).toBe(beforeMismatch.y);
    await confirm.fill(credentials.password);
    const beforeServerError = await submit.boundingBox();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let requests = 0;
    await page.route('**/api/auth/register', async (route) => {
      requests += 1;
      const response = await route.fetch();
      await gate;
      await route.fulfill({ response });
    });
    await submit.click();
    await expect(page.getByRole('button', { name: 'Создаём аккаунт…' })).toBeDisabled();
    await page.locator('.auth-form').dispatchEvent('submit');
    release();
    await expect(page.getByRole('alert')).toContainText('уже существует');
    expect(requests).toBe(1);
    expect((await submit.boundingBox()).y).toBe(beforeServerError.y);
    await page.screenshot({ path: testInfo.outputPath('registration-error.png'), fullPage: true });
  });
}
