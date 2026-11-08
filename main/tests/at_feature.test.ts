import './setup';
import test from 'node:test';
import assert from 'node:assert';
import atHelper from '../src/helpers/atHelper';
import { messageElemToNapCatSendable } from '../src/client/NapCatClient/convert';

test('AtFeature: parseTextWithAtMentions should recognize @all and @全体成员', () => {
  const input1 = '通知：明天开会 @all 准时参加';
  const result1 = atHelper.parseTextWithAtMentions(input1);

  assert.strictEqual(result1.length, 3);
  assert.strictEqual(result1[0], '通知：明天开会 ');
  assert.deepStrictEqual(result1[1], { type: 'at', qq: 'all', text: '@all' });
  assert.strictEqual(result1[2], ' 准时参加');

  const input2 = '@全体成员 请大家填写问卷';
  const result2 = atHelper.parseTextWithAtMentions(input2);
  assert.strictEqual(result2.length, 2);
  assert.deepStrictEqual(result2[0], { type: 'at', qq: 'all', text: '@全体成员' });
  assert.strictEqual(result2[1], ' 请大家填写问卷');
});

test('AtFeature: parseTextWithAtMentions should recognize QQ numbers', () => {
  const input = '请 @123456789 处理一下这个工单';
  const result = atHelper.parseTextWithAtMentions(input);

  assert.strictEqual(result.length, 3);
  assert.strictEqual(result[0], '请 ');
  assert.deepStrictEqual(result[1], { type: 'at', qq: 123456789, text: '@123456789' });
  assert.strictEqual(result[2], ' 处理一下这个工单');
});

test('AtFeature: parseTextWithAtMentions should match group member nickname/card', () => {
  const candidates = [
    { user_id: 10001, name: '张三丰' },
    { user_id: 10002, name: '张三' },
    { user_id: 10003, name: '李四' },
  ];

  // Should prioritize longer match '张三丰' over '张三'
  const input = '你好 @张三丰 还有 @李四 请注意';
  const result = atHelper.parseTextWithAtMentions(input, candidates);

  assert.strictEqual(result.length, 5);
  assert.strictEqual(result[0], '你好 ');
  assert.deepStrictEqual(result[1], { type: 'at', qq: 10001, text: '@张三丰' });
  assert.strictEqual(result[2], ' 还有 ');
  assert.deepStrictEqual(result[3], { type: 'at', qq: 10003, text: '@李四' });
  assert.strictEqual(result[4], ' 请注意');
});

test('AtFeature: parseTextWithAtMentions should NOT match email addresses', () => {
  const input = '我的邮箱是 user@example.com 请发邮件';
  const result = atHelper.parseTextWithAtMentions(input);

  // Email address should not be broken into an @ mention
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0], input);
});

test('AtFeature: NapCat converter should format @ element for OneBot 11', async () => {
  const atElem = {
    type: 'at' as const,
    qq: 12345678,
  };

  const converted = await messageElemToNapCatSendable(atElem as any);
  assert.strictEqual(converted.elem.type, 'at');
  assert.deepStrictEqual(converted.elem.data, { qq: '12345678' });

  const atAllElem = {
    type: 'at' as const,
    qq: 'all' as const,
  };
  const convertedAll = await messageElemToNapCatSendable(atAllElem as any);
  assert.strictEqual(convertedAll.elem.type, 'at');
  assert.deepStrictEqual(convertedAll.elem.data, { qq: 'all' });
});
