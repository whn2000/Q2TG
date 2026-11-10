import './setup';
import test from 'node:test';
import assert from 'node:assert';
import { NapCatClient } from '../src/client/NapCatClient';
import AliveCheckController from '../src/controllers/AliveCheckController';
import OicqErrorNotifyController from '../src/controllers/OicqErrorNotifyController';

test('NapCatClient: isOnline should return false gracefully without throwing when WS closed or callApi fails', async () => {
  const client: any = Object.create(NapCatClient.prototype);
  client.logger = {
    debug: () => {},
    warn: () => {},
    error: () => {},
    info: () => {},
  };
  client.ws = { readyState: 3 }; // CLOSED
  client._isWsConnected = false;

  // When WS closed, isOnline should immediately return false
  const online1 = await client.isOnline();
  assert.strictEqual(online1, false);

  // When WS is open but get_status rejects/times out, isOnline should catch and return false
  client.ws = { readyState: 1 };
  client._isWsConnected = true;
  client.callApi = async () => {
    throw new Error('Timeout getting status');
  };

  const online2 = await client.isOnline();
  assert.strictEqual(online2, false);
});

test('NapCatClient: meta_event heartbeat should switch online/offline state and trigger listeners', async () => {
  const client: any = Object.create(NapCatClient.prototype);
  client.logger = {
    debug: () => {},
    warn: () => {},
    error: () => {},
    info: () => {},
  };
  client.onOfflineHandlers = [];
  client.onOnlineHandlers = [];
  client.refreshSelf = async () => {};
  client._isOnline = true;

  let offlineMsg = '';
  client.onOfflineHandlers.push((msg: string) => {
    offlineMsg = msg;
  });

  let onlineCalled = false;
  client.onOnlineHandlers.push(() => {
    onlineCalled = true;
  });

  // Receive heartbeat reporting online: false
  await client.handleWebSocketMessage(JSON.stringify({
    post_type: 'meta_event',
    meta_event_type: 'heartbeat',
    status: { online: false, good: false },
    interval: 30000,
  }));

  assert.strictEqual(client._isOnline, false);
  assert.ok(offlineMsg.includes('离线') || offlineMsg.includes('offline'), `Expected offline message, got: ${offlineMsg}`);

  // Receive heartbeat reporting online: true
  await client.handleWebSocketMessage(JSON.stringify({
    post_type: 'meta_event',
    meta_event_type: 'heartbeat',
    status: { online: true, good: true },
    interval: 30000,
  }));

  assert.strictEqual(client._isOnline, true);
  assert.strictEqual(onlineCalled, true);
});

test('AliveCheckController: should reply with diagnostic report when QQ is offline instead of silent crash', async () => {
  let repliedText = '';
  const mockMessage: any = {
    isPrivate: true,
    senderId: { eq: (id: number) => id === 10001 },
    message: '/alive',
    reply: async (arg: { message: string }) => {
      repliedText = arg.message;
    },
  };

  const mockTgBot: any = {
    addNewMessageEventHandler: (handler: any) => {},
    me: { username: 'test_bot' },
    isOnline: true,
  };

  const mockTgUser: any = {
    me: { username: 'test_user', firstName: 'Tester' },
    isOnline: true,
  };

  const mockNapCatClient: any = {
    isOnline: async () => false, // QQ is offline!
    uin: 12345678,
    constructor: { name: 'NapCatClient' },
  };

  const mockInstance: any = {
    id: 1,
    owner: 10001,
    workMode: 'personal',
    isInit: true,
    qqUin: 12345678,
    oicq: mockNapCatClient,
    tgBot: mockTgBot,
    tgUser: mockTgUser,
  };

  const controller = new AliveCheckController(
    mockInstance,
    mockTgBot,
    mockTgUser,
    mockNapCatClient
  );

  // Directly invoke handleMessage
  const result = await (controller as any).handleMessage(mockMessage);
  assert.strictEqual(result, true);
  assert.ok(repliedText.length > 0, 'Telegram bot must reply with message');
  assert.ok(repliedText.includes('QQ <code>12345678</code>'), 'Must display QQ uin');
  assert.ok(repliedText.includes('坏') || repliedText.includes('掉线') || repliedText.includes('离线'), 'QQ status should be marked as bad/offline');
  assert.ok(repliedText.includes('TG @test_bot\t好'), 'Telegram bot must be marked as good');
  assert.ok(repliedText.includes('提示：QQ 机器人当前掉线'), 'Must include helpful instructions for owner');
});

test('OicqErrorNotifyController: should notify owner when QQ goes offline and comes back online', async () => {
  const sentMessages: string[] = [];
  const mockOwnerChat: any = {
    sendMessage: async (msg: string) => {
      sentMessages.push(msg);
    },
  };

  const mockInstance: any = {
    flags: 0,
    ownerChat: mockOwnerChat,
  };

  const offlineHandlers: any[] = [];
  const onlineHandlers: any[] = [];

  const mockClient: any = {
    addOfflineEventHandler: (fn: any) => offlineHandlers.push(fn),
    addOnlineEventHandler: (fn: any) => onlineHandlers.push(fn),
  };

  new OicqErrorNotifyController(mockInstance, mockClient);

  assert.strictEqual(offlineHandlers.length, 1);
  assert.strictEqual(onlineHandlers.length, 1);

  // Simulate offline event
  await offlineHandlers[0]('NapCat 连接断开');
  assert.strictEqual(sentMessages.length, 1);
  assert.ok(sentMessages[0].includes('QQ 机器人掉线'));

  // Duplicate offline event while locked should be suppressed
  await offlineHandlers[0]('NapCat 连接断开 again');
  assert.strictEqual(sentMessages.length, 1);

  // Simulate online event
  await onlineHandlers[0]();
  assert.strictEqual(sentMessages.length, 2);
  assert.ok(sentMessages[1].includes('QQ 机器人已恢复在线'));
});
