import './setup';
import test from 'node:test';
import assert from 'node:assert';
import path from 'path';
import { messageElemToNapCatSendable } from '../src/client/NapCatClient/convert';
import env from '../src/models/env';

test('NapCat Convert: path replacement should not rely on hardcoded developer drive letter', async () => {
  const sampleFilePath = path.join(env.CACHE_DIR, 'test_image.png');
  const result = await messageElemToNapCatSendable({
    type: 'image',
    file: sampleFilePath,
  });

  assert.strictEqual(result.elem.type, 'image');
  const fileData = (result.elem.data as any).file;
  // Should map CACHE_DIR to container path /app/.config/QQ/NapCat/temp/
  assert.ok(
    fileData.includes('/app/.config/QQ/NapCat/temp/test_image.png'),
    `Expected container path mapping, got: ${fileData}`
  );
  assert.ok(
    !fileData.includes('D:\\Projects\\Q2TG'),
    `Found hardcoded author path in output: ${fileData}`
  );
});
