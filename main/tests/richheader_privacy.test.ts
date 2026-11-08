import './setup';
import test from 'node:test';
import assert from 'node:assert';
import richHeader from '../src/api/richHeader';
import { Pair } from '../src/models/Pair';
import { NapCatGroupMember } from '../src/client/NapCatClient';

test('RichHeader: should not render sensitive user privacy details (birthday, email, regTimestamp)', async () => {
  // Mock Pair
  const fakeApiKey = '11111111-2222-3333-4444-555555555555';
  const mockMember = Object.create(NapCatGroupMember.prototype);
  Object.assign(mockMember, {
    uin: 12345678,
    renew: async () => ({
      card: '张三',
      nickname: '三哥',
      title: '群管',
      role: 'admin',
      join_time: 1700000000,
      last_sent_time: 1700001000,
    }),
    client: {
      pickFriend: () => ({
        renew: async () => ({
          birthday_year: 1990,
          birthday_month: 1,
          birthday_day: 1,
          eMail: 'sensitive_leak@example.com',
          nickname: '三哥',
          city: '北京市',
          qid: 'zhangsan_qid',
          country: '中国',
          province: '北京',
          regTime: 1500000000,
        }),
      }),
    },
  });

  const mockPair: any = {
    apiKey: fakeApiKey,
    qq: {
      pickMember: () => mockMember,
    },
  };

  const originalGetByApiKey = Pair.getByApiKey;
  Pair.getByApiKey = (() => mockPair) as any;

  try {
    const response = await richHeader.handle(
      new Request(`http://localhost/richHeader/${fakeApiKey}/12345678`)
    );
    assert.strictEqual(response.status, 200);
    const html = await response.text();

    // Verify safe info is present
    assert.ok(html.includes('张三'), 'Expected user nickname/card');
    assert.ok(html.includes('群管'), 'Expected user title');

    // Verify sensitive leaked fields are NOT present
    assert.ok(!html.includes('sensitive_leak@example.com'), 'Email must NOT be rendered');
    assert.ok(!html.includes('生日'), 'Birthday label must NOT be rendered');
    assert.ok(!html.includes('注册时间'), 'Registration time must NOT be rendered');
    assert.ok(!html.includes('北京市'), 'Location must NOT be rendered');
  }
  finally {
    Pair.getByApiKey = originalGetByApiKey;
  }
});
