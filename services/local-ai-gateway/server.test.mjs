import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allow, preservesFacts, server } from './server.mjs';

test('rejects rewrites that drop or change numbers', () => {
  assert.equal(
    preservesFacts('Capacité 240 min, charge 85 %.', 'Vous avez 240 min et une charge de 85 %.'),
    true,
  );
  assert.equal(preservesFacts('Solde 1 751,50 €', 'Solde 1 751,5 €'), false);
  assert.equal(preservesFacts('3 tâches', ''), false);
});

test('rate limiter blocks bursts', () => {
  let ok = 0;
  for (let i = 0; i < 40; i++) if (allow('1.2.3.4', 1_000)) ok++;
  assert.equal(ok, 30);
});

test('refuses unknown origins and unknown routes', async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    const bad = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: { Origin: 'https://evil.example' },
    });
    assert.equal(bad.status, 403);
    const health = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: { Origin: 'http://localhost:5173' },
    });
    assert.equal(health.status, 200);
    assert.equal(health.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    const missing = await fetch(`http://127.0.0.1:${port}/nope`);
    assert.equal(missing.status, 404);
    const empty = await fetch(`http://127.0.0.1:${port}/v1/rewrite`, {
      method: 'POST',
      body: JSON.stringify({ text: '' }),
    });
    assert.equal(empty.status, 400);
  } finally {
    server.close();
  }
});
