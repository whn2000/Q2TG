import './setup';
import test from 'node:test';
import assert from 'node:assert';
import telegramAvatar from '../src/api/telegramAvatar';
import q2tgServlet from '../src/api/q2tgServlet';
import db from '../src/models/db';

test('Web API: telegramAvatar should return 404 cleanly when instance is not found', async () => {
  const response = await telegramAvatar.handle(
    new Request('http://localhost/telegramAvatar/999999/123456')
  );
  assert.strictEqual(response.status, 404);
});

test('Web API: q2tgServlet should return error when uuid is not found in database', async () => {
  const fakeUuid = '00000000-0000-0000-0000-000000000000';
  const originalFindFirst = db.forwardMultiple.findFirst;
  db.forwardMultiple.findFirst = (async () => null) as any;
  try {
    const response = await q2tgServlet.handle(
      new Request('http://localhost/Q2tgServlet/GetForwardMultipleMessageApi', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ uuid: fakeUuid }),
      })
    );
    assert.strictEqual(response.status, 200);
    const json: any = await response.json();
    assert.deepStrictEqual(json, { error: 'Record not found' });
  }
  finally {
    db.forwardMultiple.findFirst = originalFindFirst;
  }
});
