import './setup';
import test from 'node:test';
import assert from 'node:assert';
import InChatCommandsService from '../src/services/InChatCommandsService';
import db from '../src/models/db';

test('InChatCommandsService: info should safely handle NapCatGroupMember without throwing', async () => {
  // Mock NapCatGroupMember
  const mockNapCatMember = {
    uin: 12345678,
    gid: 98765432,
    renew: async () => ({
      card: '群友小明',
      nickname: '小明',
      title: '活跃成员',
      role: 'admin',
      level: 10,
      join_time: 1700000000,
      last_sent_time: 1700001000,
    }),
  };

  const mockPair: any = {
    tgId: 1001,
    qqRoomId: 98765432,
    qq: {
      pickMember: (uid: number) => mockNapCatMember,
    },
  };

  const mockInstance: any = {
    id: 1,
    workMode: 'personal',
  };

  const mockTgBot: any = {};
  const mockQqClient: any = {};

  const service = new InChatCommandsService(mockInstance, mockTgBot, mockQqClient);

  // Mock db.message.findFirst
  const originalFindFirst = db.message.findFirst;
  db.message.findFirst = (async () => ({
    qqSenderId: BigInt(12345678),
    time: 1700000000,
  })) as any;

  let repliedMessage = '';
  const mockTgMessage: any = {
    replyToMsgId: 42,
    chat: { id: 1001 },
    reply: async (params: { message: string }) => {
      repliedMessage = params.message;
    },
  };

  try {
    await service.info(mockTgMessage, mockPair);
    assert.ok(repliedMessage.includes('群友小明'), `Expected card name in reply, got: ${repliedMessage}`);
    assert.ok(repliedMessage.includes('「<i>活跃成员</i>」'), `Expected title in reply, got: ${repliedMessage}`);
    assert.ok(repliedMessage.includes('12345678'), `Expected uin in reply, got: ${repliedMessage}`);
    assert.ok(repliedMessage.includes('管理员'), `Expected admin role in reply, got: ${repliedMessage}`);
  }
  finally {
    db.message.findFirst = originalFindFirst;
  }
});
