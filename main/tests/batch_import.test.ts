import './setup';
import test from 'node:test';
import assert from 'node:assert/strict';

test('Batch Import - room ID and name extraction', () => {
  const friendItem = {
    uin: 123456,
    nickname: 'TestFriend',
    remark: 'Bestie',
  };

  const groupItem = {
    gid: 987654,
    name: 'TestGroup',
  };

  const extractInfo = (item: any) => {
    const roomId = 'uin' in item ? item.uin : -item.gid;
    const name = 'uin' in item ? item.remark || item.nickname || String(item.uin) : item.name || String(item.gid);
    return { roomId, name };
  };

  assert.deepEqual(extractInfo(friendItem), { roomId: 123456, name: 'Bestie' });
  assert.deepEqual(extractInfo(groupItem), { roomId: -987654, name: 'TestGroup' });
});

test('Batch Import - unlinked items filtering & deduplication', () => {
  const existingPairs = new Set([123, -456]);
  const mockFind = (id: number) => existingPairs.has(id);

  const friends = [
    { uin: 123, nickname: 'AlreadyLinked' },
    { uin: 789, nickname: 'NewFriend1' },
    { uin: 789, nickname: 'DuplicateNewFriend1' },
    { uin: 101112, nickname: 'NewFriend2' },
  ];

  const groups = [
    { gid: 456, name: 'AlreadyLinkedGroup' },
    { gid: 999, name: 'NewGroup' },
  ];

  const uniqueFriends = friends.filter(
    (f, idx, self) => self.findIndex(x => x.uin === f.uin) === idx && !mockFind(f.uin)
  );
  assert.equal(uniqueFriends.length, 2);
  assert.equal(uniqueFriends[0].uin, 789);
  assert.equal(uniqueFriends[1].uin, 101112);

  const unlinkedGroups = groups.filter(g => !mockFind(-g.gid));
  assert.equal(unlinkedGroups.length, 1);
  assert.equal(unlinkedGroups[0].gid, 999);
});

test('Batch Import - simulate flood wait recovery logic', async () => {
  let attempts = 0;
  const mockCreate = async () => {
    attempts++;
    if (attempts === 1) {
      const err: any = new Error('FLOOD_WAIT_1');
      err.seconds = 1;
      throw err;
    }
    return true;
  };

  let success = false;
  try {
    await mockCreate();
  } catch (e: any) {
    if (e.seconds || e.message?.includes('FLOOD_WAIT')) {
      // Simulate handled wait
      await mockCreate();
      success = true;
    }
  }

  assert.equal(attempts, 2);
  assert.equal(success, true);
});

test('NapCat friend parsing - user_id and nickname compatibility', () => {
  const napCatBuddy = {
    user_id: 1770695210,
    nickname: 'TestUser',
    remark: 'TestRemark',
  };

  const parsedUid = Number(napCatBuddy.user_id ?? (napCatBuddy as any).uin);
  const parsedNick = napCatBuddy.nickname || (napCatBuddy as any).nick || '';
  const parsedRemark = napCatBuddy.remark || '';

  assert.equal(parsedUid, 1770695210);
  assert.equal(parsedNick, 'TestUser');
  assert.equal(parsedRemark, 'TestRemark');
});

test('Command parsing - bot mention stripped', () => {
  const parseCommand = (text: string) => text.split(' ')[0].split('@')[0];

  assert.equal(parseCommand('/import_all'), '/import_all');
  assert.equal(parseCommand('/import_all@FUXETZF_bot'), '/import_all');
  assert.equal(parseCommand('/import_friends@FUXETZF_bot extra_arg'), '/import_friends');
  assert.equal(parseCommand('/addfriend@FUXETZF_bot'), '/addfriend');
  assert.equal(parseCommand('/addgroup@FUXETZF_bot'), '/addgroup');
});
