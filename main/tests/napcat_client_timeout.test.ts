import './setup';
import test from 'node:test';
import assert from 'node:assert';
import { NapCatClient } from '../src/client/NapCatClient';

test('NapCatClient: callApi should reject with timeout error if no response received', async () => {
  // Create instance with mocked ws
  const mockWs = {
    send: (payload: string) => {},
    onmessage: null as any,
  };

  // Instantiate NapCatClient via Object.create
  const client: any = Object.create(NapCatClient.prototype);
  client.logger = {
    debug: () => {},
    warn: () => {},
    error: () => {},
    info: () => {},
  };
  client.ws = mockWs;
  client.echoMap = new Map();
  client.echoSeq = 0;

  // Call API with short timeout of 50ms
  const start = Date.now();
  await assert.rejects(
    async () => {
      await client.callApi('send_msg', { message: 'hello' }, 50);
    },
    (err: Error) => {
      assert.ok(err.message.includes('NapCat API 调用超时'));
      return true;
    }
  );

  const elapsed = Date.now() - start;
  assert.ok(elapsed >= 45, `Expected elapsed >= 45ms, got ${elapsed}ms`);
  assert.strictEqual(client.echoMap.size, 0, 'echoMap should be cleaned up after timeout');
});

test('NapCatClient: callApi should resolve normally when response arrives before timeout', async () => {
  let capturedEcho = '';
  const mockWs = {
    send: (payload: string) => {
      const parsed = JSON.parse(payload);
      capturedEcho = parsed.echo;
    },
  };

  const client: any = Object.create(NapCatClient.prototype);
  client.logger = {
    debug: () => {},
    warn: () => {},
    error: () => {},
    info: () => {},
  };
  client.ws = mockWs;
  client.echoMap = new Map();
  client.echoSeq = 0;

  const promise = client.callApi('get_version', {}, 500);

  // Simulate WebSocket response arriving within 20ms
  setTimeout(() => {
    client.handleWebSocketMessage(JSON.stringify({
      echo: capturedEcho,
      status: 'ok',
      data: { version: '1.0.0' },
      message: 'success',
    }));
  }, 20);

  const result = await promise;
  assert.deepStrictEqual(result, { version: '1.0.0' });
  assert.strictEqual(client.echoMap.size, 0, 'echoMap should be cleaned up after resolution');
});
