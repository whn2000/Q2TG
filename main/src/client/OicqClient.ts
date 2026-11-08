import {
  Client,
  DiscussMessageEvent,
  Forwardable,
  GroupMessageEvent,
  LogLevel,
  MemberDecreaseEvent,
  MemberIncreaseEvent,
  Platform,
  PrivateMessage,
  PrivateMessageEvent,
  FriendIncreaseEvent as OicqFriendIncreaseEvent,
  FriendRecallEvent,
  GroupRecallEvent,
  FriendPokeEvent, GroupPokeEvent, MessageElem, FriendRequestEvent, GroupInviteEvent, type ImageElem, XmlElem, Group, Member,
} from '@icqqjs/icqq';
import random from '../utils/random';
import fs from 'fs';
import fsP from 'fs/promises';
import { Config } from '@icqqjs/icqq/lib/client';
import dataPath from '../helpers/dataPath';
import os from 'os';
import { Converter, Image, rand2uuid } from '@icqqjs/icqq/lib/message';
import { randomBytes } from 'crypto';
import { escapeXml, gzip, timestamp } from '@icqqjs/icqq/lib/common';
import { pb } from '@icqqjs/icqq/lib/core';
import env from '../models/env';
import {
  CreateQQClientParamsBase, ForwardMessage, Friend, FriendIncreaseEvent, GroupMemberDecreaseEvent,
  GroupMemberIncreaseEvent, InputStatusChangeEvent,
  MessageEvent, MessageRecallEvent, PokeEvent,
  QQClient,
} from './QQClient';
import { getLogger, Logger } from 'log4js';
import posthog from '../models/posthog';

const LOG_LEVEL: LogLevel = env.OICQ_LOG_LEVEL;


export interface CreateOicqParams extends CreateQQClientParamsBase {
  type: 'oicq';
  uin: number;
  password: string;
  platform: Platform;
  signApi?: string;
  signVer?: string;
  // 当需要验证手机时调用此方法，应该返回收到的手机验证码
  onVerifyDevice: (phone: string) => Promise<string>;
  // 当滑块时调用此方法，返回 ticker，也可以返回假值改用扫码登录
  onVerifySlider: (url: string) => Promise<string>;
  signDockerId?: string;
}

// OicqExtended??
export default class OicqClient extends QQClient {
  public readonly oicq: Client;
  private readonly log: Logger;

  private constructor(uin: number, id: number, conf?: Config,
                      public readonly signDockerId?: string) {
    super(id);
    this.oicq = new Client(conf);
    this.log = getLogger(`OicqClient - ${id}`);
  }

  public get uin() {
    return this.oicq.uin;
  }

  public get nickname() {
    return this.oicq.nickname;
  }

  public async isOnline() {
    return this.oicq.isOnline();
  }

  private isOnMessageCreated = false;

  public static create(params: CreateOicqParams) {
    return new Promise<OicqClient>(async (resolve, reject) => {
      const loginDeviceHandler = async ({ phone }: { url: string, phone: string }) => {
        await client.oicq.sendSmsCode();
        const code = await params.onVerifyDevice(phone);
        if (code === 'qrsubmit') {
          await client.oicq.login();
        }
        else {
          await client.oicq.submitSmsCode(code);
        }
      };

      const loginSliderHandler = async ({ url }: { url: string }) => {
        const res = await params.onVerifySlider(url);
        if (res) {
          client.oicq.submitSlider(res);
        }
        else {
          client.oicq.login();
        }
      };

      const loginErrorHandler = ({ message }: { code: number; message: string }) => {
        reject(message);
      };

      const successLoginHandler = () => {
        client.oicq.offTrap('system.login.device', loginDeviceHandler);
        client.oicq.offTrap('system.login.slider', loginSliderHandler);
        client.oicq.offTrap('system.login.error', loginErrorHandler);
        client.oicq.offTrap('system.online', successLoginHandler);

        if (!client.isOnMessageCreated) {
          client.oicq.trap('message', client.onMessage);
          client.oicq.trap('notice.group.decrease', client.onGroupMemberDecrease);
          client.oicq.trap('notice.group.increase', client.onGroupMemberIncrease);
          client.oicq.trap('notice.friend.increase', client.onFriendIncrease);
          client.oicq.trap('notice.friend.recall', client.onMessageRecall);
          client.oicq.trap('notice.group.recall', client.onMessageRecall);
          client.oicq.trap('notice.friend.poke', client.onPoke);
          client.oicq.trap('notice.group.poke', client.onPoke);
          client.oicq.trap('request.friend', client.onFriendRequest);
          client.oicq.trap('request.group.invite', client.onGroupInvite);
          client.oicq.trap('internal.input', client.onInput);
          client.isOnMessageCreated = true;
        }

        resolve(client);
      };

      if (!fs.existsSync(dataPath(`${params.uin}/device.json`))) {
        await fsP.mkdir(dataPath(params.uin.toString()), { recursive: true });

        const device = {
          product: 'Q2TG',
          device: 'ANGELKAWAII2',
          board: 'sleepyfox',
          brand: random.pick('GOOGLE', 'XIAOMI', 'HUAWEI', 'SAMSUNG', 'SONY'),
          model: 'sleepyfox',
          wifi_ssid: random.pick('OpenWrt', `Redmi-${random.hex(4).toUpperCase()}`,
            `MiWifi-${random.hex(4).toUpperCase()}`, `TP-LINK-${random.hex(6).toUpperCase()}`),
          bootloader: random.pick('U-Boot', 'GRUB', 'gummiboot'),
          android_id: random.hex(16),
          proc_version: `${os.type()} version ${os.release()}`,
          mac_address: `8c:85:90:${random.hex(2)}:${random.hex(2)}:${random.hex(2)}`.toUpperCase(),
          ip_address: `192.168.${random.int(1, 200)}.${random.int(10, 250)}`,
          incremental: random.int(0, 4294967295),
          imei: random.imei(),
        };

        await fsP.writeFile(dataPath(`${params.uin}/device.json`), JSON.stringify(device, null, 0), 'utf-8');
      }

      const client = new this(params.uin, params.id, {
        platform: params.platform,
        data_dir: dataPath(params.uin.toString()),
        log_level: LOG_LEVEL,
        ffmpeg_path: env.FFMPEG_PATH,
        ffprobe_path: env.FFPROBE_PATH,
        sign_api_addr: params.signApi || env.SIGN_API,
        ver: params.signVer || env.SIGN_VER,
      }, params.signDockerId);
      client.oicq.on('system.login.device', loginDeviceHandler);
      client.oicq.on('system.login.slider', loginSliderHandler);
      client.oicq.on('system.login.error', loginErrorHandler);
      client.oicq.on('system.online', successLoginHandler);

      client.oicq.login(params.uin, params.password);
    });
  }

  private onMessage = async (event: PrivateMessageEvent | GroupMessageEvent | DiscussMessageEvent) => {
    if (event.message_type === 'discuss') return;
    this.log.debug('OicqClient.onMessage', event);

    let chat: Friend | Group | Member = 'group' in event ? event.group : event.friend;
    if (event.message_type === 'private' && event.sender.group_id) {
      chat = this.oicq.pickMember(event.sender.group_id, event.sender.user_id);
    }

    const gEvent = new MessageEvent(
      { id: event.sender.user_id, name: ('card' in event.sender && event.sender.card) || event.sender.nickname },
      chat as any,
      event.message,
      event.seq,
      event.rand,
      event.pktnum,
      event.time,
      event.raw_message,
      event.source && { ...event.source, fromId: event.source.user_id, message: event.source.message as MessageElem[] },
      'anonymous' in event ? event.anonymous : undefined,
      event.message_id,
      'atme' in event ? event.atme : false,
      'atall' in event ? event.atall : false,
      event.message_type === 'private' ? event.sender.group_id : undefined,
    );
    await this.callHandlers(this.onMessageHandlers, gEvent);
  };

  private onGroupMemberIncrease = async (event: MemberIncreaseEvent) => {
    const gEvent = new GroupMemberIncreaseEvent(event.group, event.user_id, event.nickname);
    await this.callHandlers(this.onGroupMemberIncreaseHandlers, gEvent);
  };

  private onGroupMemberDecrease = async (event: MemberDecreaseEvent) => {
    const gEvent = new GroupMemberDecreaseEvent(event.group, event.user_id, event.operator_id, event.dismiss);
    await this.callHandlers(this.onGroupMemberDecreaseHandlers, gEvent);
  };

  private onFriendIncrease = async (event: OicqFriendIncreaseEvent) => {
    const gEvent = new FriendIncreaseEvent(event.friend);
    await this.callHandlers(this.onFriendIncreaseHandlers, gEvent);
  };

  private onMessageRecall = async (event: FriendRecallEvent | GroupRecallEvent) => {
    const gEvent = new MessageRecallEvent('friend' in event ? event.friend : event.group, event.seq, event.rand, event.time);
    await this.callHandlers(this.onMessageRecallHandlers, gEvent);
  };

  private onPoke = async (event: FriendPokeEvent | GroupPokeEvent) => {
    const gEvent = new PokeEvent('friend' in event ? event.friend : event.group, event.operator_id, event.target_id, event.action, event.suffix);
    await this.callHandlers(this.onPokeHandlers, gEvent);
  };

  private onFriendRequest = async (event: FriendRequestEvent) => {
    await this.callHandlers(this.onFriendRequestHandlers, event);
  };

  private onGroupInvite = async (event: GroupInviteEvent) => {
    await this.callHandlers(this.onGroupInviteHandlers, event);
  };

  private onInput = async (event: { user_id: number, end: boolean }) => {
    await this.callHandlers(this.onInputStatusChangeHandlers, new InputStatusChangeEvent(await this.pickFriend(event.user_id), !event.end));
  };

  public async makeForwardMsgSelf(msglist: Forwardable[] | Forwardable, dm?: boolean): Promise<{
    resid: string,
    tSum: number
  }> {
    if (!Array.isArray(msglist))
      msglist = [msglist];
    const nodes = [];
    const makers: Converter[] = [];
    let imgs: Image[] = [];
    let cnt = 0;
    for (const fake of msglist) {
      const maker = new Converter(fake.message, { dm, cachedir: this.oicq.config.data_dir });
      makers.push(maker);
      const seq = randomBytes(2).readInt16BE();
      const rand = randomBytes(4).readInt32BE();
      let nickname = String(fake.nickname || fake.user_id);
      if (!nickname && fake instanceof PrivateMessage)
        nickname = this.oicq.fl.get(fake.user_id)?.nickname || this.oicq.sl.get(fake.user_id)?.nickname || nickname;
      if (cnt < 4) {
        cnt++;
      }
      nodes.push({
        1: {
          1: fake.user_id,
          2: this.oicq.uin,
          3: dm ? 166 : 82,
          4: dm ? 11 : null,
          5: seq,
          6: fake.time || timestamp(),
          7: rand2uuid(rand),
          9: dm ? null : {
            1: this.oicq.uin,
            4: nickname,
          },
          14: dm ? nickname : null,
          20: {
            1: 0,
            2: rand,
          },
        },
        3: {
          1: maker.rich,
        },
      });
    }
    for (const maker of makers)
      imgs = [...imgs, ...maker.imgs];
    const contact = await (dm ? this.pickFriend : this.pickGroup).bind(this)(this.oicq.uin);
    if (imgs.length)
      await contact.uploadImages(imgs);
    const compressed = await gzip(pb.encode({
      1: nodes,
      2: [{
        1: 'MultiMsg',
        2: {
          1: nodes,
        },
      }],
    }));
    const _uploadMultiMsg = Reflect.get(contact, '_uploadMultiMsg') as Function;
    const resid = await _uploadMultiMsg.apply(contact, [compressed]);
    return {
      tSum: nodes.length,
      resid,
    };
  }

  async pickFriend(uin: number, tempChatFromGroupId?: number) {
    if (tempChatFromGroupId) {
      return this.oicq.pickMember(tempChatFromGroupId, uin) as any;
    }
    return this.oicq.pickFriend(uin);
  }

  async pickGroup(groupId: number) {
    return this.oicq.pickGroup(groupId);
  }

  async getFriendsWithCluster() {
    const result = [] as { name: string, friends: Friend[] }[];
    const friends = Array.from(this.oicq.fl.values());
    for (const [clusterId, name] of this.oicq.classes) {
      result.push({
        name,
        friends: await Promise.all(friends.filter(f => f.class_id === clusterId).map(f => this.pickFriend(f.user_id))),
      });
    }
    return result;
  }

  async getGroupList() {
    return await Promise.all(Array.from(this.oicq.gl.values()).map(g => this.pickGroup(g.group_id)));
  }

  async getCustomFaceList(count = 1000): Promise<Array<{
    url: string;
    md5?: string;
    desc?: string;
  }>> {
    return [];
  }

  override async createSpoilerImageEndpoint(image: ImageElem, nickname: string, title?: string) {
    const msgList: Forwardable[] = [{
      user_id: this.oicq.uin,
      nickname,
      message: image,
    }];
    if (title) {
      msgList.push({
        user_id: this.oicq.uin,
        nickname,
        message: title,
      });
    }
    const fake = await this.makeForwardMsgSelf(msgList);
    return [{
      type: 'xml',
      id: 60,
      data: `<?xml version="1.0" encoding="utf-8"?>` +
        `<msg serviceID="35" templateID="1" action="viewMultiMsg" brief="[Spoiler 图片]"
 m_resid="${fake.resid}" m_fileName="${random.fakeUuid().toUpperCase()}" tSum="${fake.tSum}"
 sourceMsgId="0" url="" flag="3" adverSign="0" multiMsgFlag="0"><item layout="1"
 advertiser_id="0" aid="0"><title size="34" maxLines="2" lineSpace="12"
>${escapeXml(nickname)}</title
><title size="26" color="#777777" maxLines="2" lineSpace="12">Spoiler 图片</title
>${title ? `<title color="#303133" size="26">${escapeXml(title)}</title>` : ''
        }<hr hidden="false" style="0" /><summary size="26" color="#777777">请谨慎查看</summary
></item><source name="Q2TG" icon="" action="" appid="-1" /></msg>`.replaceAll('\n', ''),
    } as XmlElem] as any;
  }

  private rKeyCache = null as { offNTPicRkey: string, groupNTPicRkey: string };

  public async getNTPicRKey() {
    if (!this.rKeyCache) {
      // https://github.com/Icalingua-plus-plus/oicq-icalingua-plus-plus/blob/a8fa0e6e2448a626491cf365e1beb23f2e82a509/lib/message/image.js#L718
      const body = pb.encode({
        1: {
          1: {
            1: 1,
            2: 202,
          },
          2: {
            101: 2,
            102: 1,
            200: 0,
          },
          3: {
            1: 2,
          },
        },
        4: {
          1: [10, 20],
          2: 2,
        },
      });
      const ret = {
        offNTPicRkey: '',
        groupNTPicRkey: '',
      };

      try {
        const rsp = await this.oicq.sendOidbSvcTrpcTcp('OidbSvcTrpcTcp.0x9067_202', body);
        const rkeys = rsp[4][1];
        if (!rkeys)
          throw new Error('rkey 不存在');
        const rkeyType = {
          10: 'offNTPicRkey',
          20: 'groupNTPicRkey',
        };
        for (const v of rkeys) {
          ret[rkeyType[v[5]]] = v[1].toString().substring('&rkey='.length);
        }
      }
      catch (e) {
        this.log.warn('获取 QQNT Rkey 失败', e.message);
        posthog.capture('获取 QQNT Rkey 失败', { error: e.message });
      }

      this.rKeyCache = ret;
    }
    return this.rKeyCache;
  }

  public async refreshImageRKey(messages: ForwardMessage[]) {
    const rKey = await this.getNTPicRKey();
    if (!rKey) {
      this.log.warn('未获取到 QQNT Rkey，无法刷新图片 rkey');
      return;
    }
    for (const message of messages) {
      for (const element of message.message) {
        if (element.type !== 'image') continue;
        if (!element.url) continue;
        const url = new URL(element.url);
        if (url.host !== 'multimedia.nt.qq.com.cn') continue;

        switch (url.searchParams.get('appid')) {
          case '1406':
            url.searchParams.set('rkey', rKey.offNTPicRkey);
            break;
          case '1407':
            url.searchParams.set('rkey', rKey.groupNTPicRkey);
            break;
        }
        element.url = url.toString();
      }
    }
  }
}
