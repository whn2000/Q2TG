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

test('Video: napCatReceiveToMessageElem parses video with url, fid, file', () => {
  const receiveVideo = {
    type: 'video' as const,
    data: {
      file: 'video_123.mp4',
      url: 'http://gzc-download.ftn.qq.com/video_123.mp4',
      path: '/napcat/temp/video_123.mp4',
      file_id: 'video_id_123',
      file_size: '2048',
      file_unique: 'unique_video_123',
    },
  };
  const parsed = napCatReceiveToMessageElem(receiveVideo) as any;
  assert.strictEqual(parsed.type, 'video');
  assert.strictEqual(parsed.url, 'http://gzc-download.ftn.qq.com/video_123.mp4');
  assert.strictEqual(parsed.fid, 'http://gzc-download.ftn.qq.com/video_123.mp4');
  assert.strictEqual(parsed.file, 'video_123.mp4');
});

test('NapCat: napCatReceiveToMessageElem handles node as forward', () => {
  const receiveNode = {
    type: 'node' as any,
    data: {
      id: 'node_msg_1',
      content: [
        {
          type: 'text',
          data: { text: 'hello inside node' },
        },
      ],
    },
  };
  const parsed = napCatReceiveToMessageElem(receiveNode) as any;
  assert.strictEqual(parsed.type, 'forward');
  assert.strictEqual(parsed.id, 'node_msg_1');
  assert.ok(Array.isArray(parsed.content));
  assert.strictEqual(parsed.content[0].message[0].text, 'hello inside node');
});

test('NapCat: napCatForwardMultiple handles node structure correctly', () => {
  const nodeMessages = [
    {
      type: 'node',
      data: {
        user_id: 123456,
        nickname: 'NodeUser',
        time: 1700000010,
        content: [
          { type: 'text', data: { text: 'content inside node' } },
        ],
      },
    },
  ];
  const result = napCatForwardMultiple(nodeMessages);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].nickname, 'NodeUser');
  assert.strictEqual(result[0].user_id, 123456);
  assert.strictEqual(result[0].message.length, 1);
  assert.strictEqual((result[0].message[0] as any).text, 'content inside node');
});

test('NapCat: napCatReceiveToMessageElem does not throw on unknown element type', () => {
  const unknownElem = {
    type: 'some_future_unsupported_type' as any,
    data: { text: 'fallback text' },
  };
  const parsed = napCatReceiveToMessageElem(unknownElem) as any;
  assert.strictEqual(parsed.type, 'text');
  assert.strictEqual(parsed.text, 'fallback text');
});

test('Forward: processJson parses various multimsg formats and extracts resid', () => {
  // Format 1: standard detail
  const json1 = JSON.stringify({
    app: 'com.tencent.multimsg',
    meta: { detail: { resid: 'res123', uniseq: 'seq123' } },
  });
  const res1 = forwardHelper.processJson(json1);
  assert.strictEqual(res1.type, 'forward');
  assert.strictEqual((res1 as any).resId, 'res123');
  assert.strictEqual((res1 as any).fileName, 'seq123');

  // Format 2: c2c multimsg with detail_1 and extra JSON filename
  const json2 = JSON.stringify({
    app: 'com.tencent.c2c.multimsg',
    extra: '{"filename":"extra_file.dat","tsum":3}',
    meta: { detail_1: { resId: 'res456' } },
  });
  const res2 = forwardHelper.processJson(json2);
  assert.strictEqual(res2.type, 'forward');
  assert.strictEqual((res2 as any).resId, 'res456');
  assert.strictEqual((res2 as any).fileName, 'extra_file.dat');

  // Format 3: prompt with [聊天记录]
  const json3 = JSON.stringify({
    app: 'custom.app',
    prompt: '[聊天记录]',
    meta: { news: { resid: 'res789' } },
  });
  const res3 = forwardHelper.processJson(json3);
  assert.strictEqual(res3.type, 'forward');
  assert.strictEqual((res3 as any).resId, 'res789');
});

test('Forward: processXml parses resid, res_id and m_resid with fileName', () => {
  const xml1 = '<msg serviceID="35" action="viewMultiMsg" resid="res_xml_1" uniseq="file_seq_1" />';
  const res1 = forwardHelper.processXml(xml1);
  assert.strictEqual(res1.type, 'forward');
  assert.strictEqual((res1 as any).resId, 'res_xml_1');
  assert.strictEqual((res1 as any).fileName, 'file_seq_1');

  const xml2 = '<msg action="viewMultiMsg" res_id="res_xml_2" />';
  const res2 = forwardHelper.processXml(xml2);
  assert.strictEqual(res2.type, 'forward');
  assert.strictEqual((res2 as any).resId, 'res_xml_2');
});

test('Video: resolveForwardVideos resolves video URLs and upgrades Tencent CDN http to https', async () => {
  const mockPair = {
    qq: {
      getVideoUrl: async (fid: string, md5: string) => {
        return `http://multimedia.nt.qq.com.cn/download?fid=${fid}&md5=${md5}`;
      },
    },
  };

  const messages: ForwardMessage[] = [
    {
      user_id: 1,
      nickname: 'User1',
      time: 1700000000,
      seq: 1,
      raw_message: '',
      message: [
        {
          type: 'video',
          fid: 'video_fid_1',
          md5: 'video_md5_1',
        } as any,
        {
          type: 'forward',
          id: 'nested_fwd',
          content: [
            {
              user_id: 2,
              nickname: 'User2',
              time: 1700000001,
              seq: 2,
              raw_message: '',
              message: [
                {
                  type: 'video',
                  fid: 'video_fid_nested',
                  md5: 'video_md5_nested',
                } as any,
              ],
            },
          ],
        } as any,
      ],
    },
  ];

  await forwardHelper.resolveForwardVideos(messages, mockPair);

  const topVideo = messages[0].message[0] as any;
  assert.strictEqual(topVideo.url, 'https://multimedia.nt.qq.com.cn/download?fid=video_fid_1&md5=video_md5_1');

  const nestedVideo = (messages[0].message[1] as any).content[0].message[0] as any;
  assert.strictEqual(nestedVideo.url, 'https://multimedia.nt.qq.com.cn/download?fid=video_fid_nested&md5=video_md5_nested');
});

test('Nested Forward: processNestedForward handles empty resId with nestedContent', async () => {
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
    const nestedMessages: ForwardMessage[] = [
      {
        user_id: 99,
        nickname: 'NestedUser',
        time: 1700000000,
        seq: 99,
        raw_message: '',
        message: [{ type: 'text', text: 'nested text' } as any],
      },
    ];

    const messages: ForwardMessage[] = [
      {
        user_id: 1,
        nickname: 'Alice',
        time: 1700000000,
        seq: 1,
        raw_message: '',
        message: [
          {
            type: 'forward',
            id: '', // Empty resId!
            content: nestedMessages,
          } as any,
        ],
      },
    ];

    await processNestedForward(messages, 42);

    const forwardElem = messages[0].message[0] as any;
    assert.ok(forwardElem.uuid, 'forward element must have uuid assigned');
    assert.ok(forwardCache.has(forwardElem.uuid), 'forwardCache must contain nested messages');
    assert.strictEqual(createdEntities.length, 1);
    assert.ok(createdEntities[0].resId.startsWith('nested_'));
  }
  finally {
    db.forwardMultiple.findFirst = originalFindFirst;
    db.forwardMultiple.create = originalCreate;
  }
});
