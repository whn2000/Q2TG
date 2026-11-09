import './setup';
import test from 'node:test';
import assert from 'node:assert';
import silk from '../src/encoding/silk';
import { messageElemToNapCatSendable, napCatReceiveToMessageElem, napCatForwardMultiple } from '../src/client/NapCatClient/convert';
import forwardHelper from '../src/helpers/forwardHelper';
import processNestedForward from '../src/utils/processNestedForward';
import db from '../src/models/db';
import { forwardCache } from '../src/api/q2tgServlet';
import { ForwardMessage } from '../src/client/QQClient';

test('Voice: isSilk correctly detects silk audio header', () => {
  const standardSilk = Buffer.from('#!SILK_V3_voice_payload_data');
  const tencentSilk = Buffer.concat([Buffer.from([0x02]), Buffer.from('#!SILK_V3_voice_payload_data')]);
  const mp3Data = Buffer.from('ID3_not_a_silk_header');

  assert.strictEqual(silk.isSilk(standardSilk), true);
  assert.strictEqual(silk.isSilk(tencentSilk), true);
  assert.strictEqual(silk.isSilk(mp3Data), false);
  assert.strictEqual(silk.isSilk(Buffer.alloc(0)), false);
});

test('Voice: messageElemToNapCatSendable uses .silk postfix for record buffer', async () => {
  const sampleSilkBuffer = Buffer.from('#!SILK_V3_test');
  const result = await messageElemToNapCatSendable({
    type: 'record',
    file: sampleSilkBuffer,
  });

  assert.strictEqual(result.elem.type, 'record');
  assert.strictEqual(result.tempFiles.length, 1);
  const tempPath = result.tempFiles[0].path;
  assert.ok(tempPath.endsWith('.silk'), `Temp file for record should end with .silk, got: ${tempPath}`);
  result.tempFiles[0].cleanup();
});

test('Voice: napCatReceiveToMessageElem correctly handles record', () => {
  const receiveRecord = {
    type: 'record' as const,
    data: {
      file: '7CE62E2554619B00192A0CD97593BE45.silk',
      url: 'http://example.com/voice.silk',
      path: '/napcat/temp/voice.silk',
      file_id: 'voice_id_123',
      file_size: '1024',
      file_unique: 'unique_123',
    },
  };

  const parsed = napCatReceiveToMessageElem(receiveRecord) as any;
  assert.strictEqual(parsed.type, 'record');
  assert.strictEqual(parsed.file, '7CE62E2554619B00192A0CD97593BE45.silk');
  assert.strictEqual(parsed.url, 'http://example.com/voice.silk');
});

test('Nested Forward: napCatForwardMultiple handles missing sender and raw_message safely', () => {
  const mockMessages: any[] = [
    {
      message_id: 101,
      time: 1700000000,
      message_type: 'group',
      group_id: 123456,
      sender: null,
      raw_message: null,
      message: [{ type: 'text', data: { text: 'hello' } }],
    },
  ];

  const result = napCatForwardMultiple(mockMessages);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].nickname, 'QQ用户');
  assert.strictEqual(result[0].raw_message, '');
  assert.strictEqual(result[0].message.length, 1);
  assert.strictEqual((result[0].message[0] as any).text, 'hello');
});

test('Nested Forward: generateForwardBrief handles missing raw_message without throwing', () => {
  const messages: ForwardMessage[] = [
    {
      user_id: 1,
      nickname: 'Alice',
      time: 1700000000,
      seq: 1,
      raw_message: undefined as any,
      message: [{ type: 'text', text: 'fallback text' } as any],
    },
  ];

  const brief = forwardHelper.generateForwardBrief(messages);
  assert.ok(brief.includes('Alice'));
  assert.ok(brief.includes('fallback'));
});

test('Nested Forward: processNestedForward handles JSON, XML, NapCat forward and recursive nesting', async () => {
  const createdEntities: Array<{ id: string; resId: string }> = [];
  const originalFindFirst = db.forwardMultiple.findFirst;
  const originalCreate = db.forwardMultiple.create;

  db.forwardMultiple.findFirst = (async ({ where }: any) => {
    return createdEntities.find(e => e.resId === where.resId) || null;
  }) as any;

  db.forwardMultiple.create = (async ({ data }: any) => {
    const newEntry = {
      id: `uuid-${data.resId}`,
      resId: data.resId,
      fileName: data.fileName || '',
      fromPairId: data.fromPairId,
    };
    createdEntities.push(newEntry);
    return newEntry;
  }) as any;

  try {
    // 3 levels of nesting:
    // Level 1 contains:
    //   - a JSON forward
    //   - an XML forward
    //   - a NapCat native forward containing Level 2
    // Level 2 contains:
    //   - another NapCat forward containing Level 3
    // Level 3 contains normal text
    const level3Messages: ForwardMessage[] = [
      {
        user_id: 3,
        nickname: 'Charlie',
        time: 1700000002,
        seq: 3,
        raw_message: 'deepest message',
        message: [{ type: 'text', text: 'deepest message' } as any],
      },
    ];

    const level2Messages: ForwardMessage[] = [
      {
        user_id: 2,
        nickname: 'Bob',
        time: 1700000001,
        seq: 2,
        raw_message: 'level 2 forward',
        message: [
          {
            type: 'forward',
            id: 'res-level-3',
            content: level3Messages,
          } as any,
        ],
      },
    ];

    const level1Messages: ForwardMessage[] = [
      {
        user_id: 1,
        nickname: 'Alice',
        time: 1700000000,
        seq: 1,
        raw_message: 'level 1 message',
        message: [
          {
            type: 'json',
            data: JSON.stringify({
              app: 'com.tencent.multimsg',
              meta: { detail: { resid: 'res-json-1', uniseq: 'file1' } },
            }),
          } as any,
          {
            type: 'xml',
            data: '<msg action="viewMultiMsg" m_resid="res-xml-1" />',
          } as any,
          {
            type: 'forward',
            id: 'res-level-2',
            content: level2Messages,
          } as any,
        ],
      },
    ];

    await processNestedForward(level1Messages, 42);

    // Verify all 4 forwards were registered in database
    assert.strictEqual(createdEntities.length, 4);
    assert.ok(createdEntities.some(e => e.resId === 'res-json-1'));
    assert.ok(createdEntities.some(e => e.resId === 'res-xml-1'));
    assert.ok(createdEntities.some(e => e.resId === 'res-level-2'));
    assert.ok(createdEntities.some(e => e.resId === 'res-level-3'));

    // Verify level 1 JSON forward elem was converted
    const jsonElem = level1Messages[0].message[0] as any;
    const parsedJsonData = JSON.parse(jsonElem.data);
    assert.strictEqual(parsedJsonData.type, 'forward');
    assert.strictEqual(parsedJsonData.uuid, 'uuid-res-json-1');

    // Verify level 1 XML forward elem was converted
    const xmlElem = level1Messages[0].message[1] as any;
    assert.strictEqual(xmlElem.type, 'forward');
    assert.strictEqual(xmlElem.uuid, 'uuid-res-xml-1');

    // Verify level 1 NapCat forward elem has UUID and its nested content was cached
    const napCatElem = level1Messages[0].message[2] as any;
    assert.strictEqual(napCatElem.uuid, 'uuid-res-level-2');
    assert.ok(forwardCache.has('uuid-res-level-2'));

    // Verify level 2 forward inside level 1 was also processed recursively
    const nestedNapCatElem = level2Messages[0].message[0] as any;
    assert.strictEqual(nestedNapCatElem.uuid, 'uuid-res-level-3');
    assert.ok(forwardCache.has('uuid-res-level-3'));
  }
  finally {
    db.forwardMultiple.findFirst = originalFindFirst;
    db.forwardMultiple.create = originalCreate;
  }
});
