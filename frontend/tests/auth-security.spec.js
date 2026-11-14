import { test, expect } from 'playwright/test';
import { randomUUID } from 'node:crypto';

test.use({ trace: 'off', screenshot: 'off' });

for (const theme of ['Светлая тема', 'Тёмная тема']) {
  test('auth lifecycle in ' + theme, async ({ page, context }) => {
    const email = randomUUID() + '@example.com';
    const password = randomUUID();
    const button = (name) => page.getByRole('button', { name, exact: true });
    const heading = (name) => page.getByRole('heading', { name, exact: true });
    async function fillCredentials() {
      await page.getByLabel('Электронная почта').fill(email);
      await page.getByLabel('Пароль', { exact: true }).fill(password);
    }

    await page.goto('/');
    await button(theme).click();
    await button('Создать аккаунт').click();
    await fillCredentials();
    await page.getByLabel('Подтвердите пароль').fill(password);
    await button('Создать аккаунт').click();
    await expect(heading('Спрос на вашем маршруте')).toBeVisible();

    await page.reload();
    await expect(heading('Спрос на вашем маршруте')).toBeVisible();
    await button('Выйти').click();
    await expect(heading('С возвращением')).toBeVisible();

    await button('Создать аккаунт').click();
    await fillCredentials();
    await page.getByLabel('Подтвердите пароль').fill(password);
    await button('Создать аккаунт').click();
    await expect(page.getByRole('alert')).toContainText('уже существует');

    await button('Войти').click();
    await fillCredentials();
    await page.getByLabel('Пароль', { exact: true }).fill(randomUUID());
    await page.getByRole('button', { name: /Войти в систему/ }).click();
    await expect(page.getByRole('alert')).toContainText('Неверная почта или пароль');

    await fillCredentials();
    await page.getByRole('button', { name: /Войти в систему/ }).click();
    await expect(heading('Спрос на вашем маршруте')).toBeVisible();
    const calculate = button('Рассчитать прогноз');
    await expect(calculate).toBeEnabled();
    await context.clearCookies();
    await calculate.click();
    await expect(page.getByRole('alert')).toContainText('Сессия истекла');
  });
}

test.describe('independent authentication scenarios', () => {
  let email;
  let password;

  test.beforeEach(async () => {
    email = randomUUID() + '@example.com';
    password = randomUUID();
  });

  async function createAccount(page, email, password) {
    const response = await page.request.post('/api/auth/register', {
      data: { email, password },
      headers: { 'X-Requested-With': 'reshis' },
    });
    expect(response.status()).toBe(201);
  }

  async function openLogin(page) {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'С возвращением' })).toBeVisible();
  }

  test('protected API and dashboard require an authenticated session', async ({ page }) => {
    expect((await page.request.get('/api/routes')).status()).toBe(401);
    await openLogin(page);
    await expect(page.getByRole('heading', { name: 'Спрос на вашем маршруте' })).toHaveCount(0);
  });

  test('duplicate registration displays the server error', async ({ page, context }) => {
    await createAccount(page, email, password);
    await context.clearCookies();
    await openLogin(page);
    await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
    await page.getByLabel('Электронная почта').fill(email);
    await page.getByLabel('Пароль', { exact: true }).fill(password);
    await page.getByLabel('Подтвердите пароль').fill(password);
    await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('уже существует');
  });

  test('wrong password leaves the user signed out', async ({ page, context }) => {
    await createAccount(page, email, password);
    await context.clearCookies();
    await openLogin(page);
    await page.getByLabel('Электронная почта').fill(email);
    await page.getByLabel('Пароль', { exact: true }).fill(randomUUID());
    await page.getByRole('button', { name: 'Войти в систему' }).click();
    await expect(page.getByRole('alert')).toContainText('Неверная почта или пароль');
    expect((await page.request.get('/api/auth/me')).status()).toBe(401);
  });

  test('valid login survives reload, logout and another login', async ({ page, context }) => {
    await createAccount(page, email, password);
    await context.clearCookies();
    await openLogin(page);
    async function login() {
      await page.getByLabel('Электронная почта').fill(email);
      await page.getByLabel('Пароль', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Войти в систему' }).click();
      await expect(page.getByRole('heading', { name: 'Спрос на вашем маршруте' })).toBeVisible();
    }
    await login();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Спрос на вашем маршруте' })).toBeVisible();
    await page.getByRole('button', { name: 'Выйти', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'С возвращением' })).toBeVisible();
    expect((await page.request.get('/api/routes')).status()).toBe(401);
    await login();
  });
});
