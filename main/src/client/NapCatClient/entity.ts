import { MessageRet, Quotable } from '@icqqjs/icqq';
import { Friend, Group, GroupFs, GroupMember, QQEntity, QQUser, Sendable, SendableElem } from '../QQClient';
import { NapCatClient } from './client';
import { messageElemToNapCatSendable, napCatForwardMultiple, napCatReceiveToMessageElem } from './convert';
import { getLogger, Logger } from 'log4js';
import posthog from '../../models/posthog';
import type { Send, WSSendReturn } from 'node-napcat-ts';
import { FileResult } from 'tmp-promise';

const createSpoilerExtra = (chain: Sendable) => {
  if (!Array.isArray(chain)) throw new Error('喵喵喵？（!Array.isArray(chain)）');
  const rChain = chain.filter(it => typeof it === 'object' && it.type === 'node');
  const last = rChain[rChain.length - 1];
  const text = (typeof last.message === 'object' && !Array.isArray(last.message) && last.message.type === 'text') ? last.message.text : '';
  const news = [{
    text: 'Spoiler 图片',
  }];
  if (text) {
    news.push({ text });
  }
  news.push({
    text: '请谨慎查看',
  });
  return {
    prompt: '[Spoiler 图片]',
    summary: 'Powered by Q2TG',
    source: `${rChain[0].nickname}:`,
  };
};

export abstract class NapCatEntity implements QQEntity {
  protected logger: Logger;

  protected constructor(public readonly client: NapCatClient) {
    this.logger = getLogger('NapCatEntity');
  }

  abstract dm: boolean;

  async getForwardMsg(resid: string, fileName?: string) {
    try {
      // OneBot 11 与 NapCat 兼容参数: id, message_id, messager_id
      const data = await this.client.callApi('get_forward_msg', {
        message_id: resid,
        id: resid,
        messager_id: resid,
      } as any);
      return napCatForwardMultiple(data?.messages || []);
    }
    catch (e) {
      this.logger.error('NapCat get_forward_msg 失败', e);
      return [];
    }
  }

  async getVideoUrl(fid: string, md5?: string | Buffer): Promise<string> {
    if (!fid) return '';
    if (/^https?:\/\//.test(fid)) return fid;
    try {
      const data = await this.client.callApi('get_file', { file_id: fid });
      return data?.url || data?.file || fid;
    }
    catch {
      return fid;
    }
  }

  async recallMsg(paramOrMessageId: number, rand?: number, timeOrPktNum?: number): Promise<boolean> {
    try {
      await this.client.callApi('delete_msg', { message_id: paramOrMessageId });
      return true;
    }
    catch (e) {
      this.logger.error('消息撤回失败', e);
      posthog.capture('NapCat 消息撤回失败', { error: e });
      return false;
    }
  }

  protected abstract sendMsgImpl(message: Send[keyof Send][], extra?: Record<string, any>): Promise<MessageRet>;

  async sendMsg(content: Sendable, source?: Quotable, isSpoiler?: boolean): Promise<MessageRet> {
    if (!Array.isArray(content)) {
      content = [content];
    }
    content = content.map(it => {
      if (typeof it === 'string') {
        return { type: 'text', text: it };
      }
      return it;
    });

    const tmpFiles: FileResult[] = [];
    const message = await Promise.all(content.map(async it => {
      const { elem, tempFiles } = await messageElemToNapCatSendable(it as SendableElem);
      tmpFiles.push(...tempFiles);
      return elem;
    }));
    if (source) {
      // TODO 不同框架 messageId / seq 不一样，无缝模式下不能交叉回复
      message.unshift({
        type: 'reply',
        data: {
          id: source.seq.toString(),
        },
      });
    }

    const ret = await this.sendMsgImpl(message, isSpoiler ? createSpoilerExtra(content) : {});
    tmpFiles.forEach(it => it.cleanup());
    return ret;
  }

  // 文件会被下载，返回的是绝对路径
  async getFileUrl(fid: string): Promise<string> {
    const data = await this.client.callApi('get_file', { file_id: fid });
    return data.file;
  }
}

abstract class NapCatUser extends NapCatEntity implements QQUser {
  public readonly dm = true;
  nickname: string;

  protected constructor(client: NapCatClient,
                        public readonly uin: number) {
    super(client);
  }

  protected async sendMsgImpl(message: Send[keyof Send][], extra = {}): Promise<MessageRet> {
    const data = await this.client.callApi('send_private_msg', {
      user_id: this.uin,
      ...extra,
      // @ts-ignore 库的问题
      message,
    });
    return {
      message_id: data.message_id.toString(),
      seq: data.message_id,
      time: Date.now() / 1000,
      rand: 0,
    };
  }

  async poke(self?: boolean): Promise<boolean> {
    if (self) {
      throw new Error('NapCat 不支持自己戳自己');
    }
    try {
      await this.client.callApi('friend_poke', { user_id: this.uin });
      return true;
    }
    catch (e) {
      this.logger.error('戳一戳失败', e);
      posthog.capture('NapCat 戳一戳失败', { error: e });
      return false;
    }
  }
}

export class NapCatFriend extends NapCatUser implements Friend {
  remark: string;

  private constructor(client: NapCatClient, uid: number) {
    super(client, uid);
  }

  public static async create(client: NapCatClient, uid: number): Promise<NapCatFriend> {
    const instance = new this(client, uid);
    await instance.renew();
    return instance;
  }

  public static createExisted(client: NapCatClient, info: { nickname: string, remark: string, uid: number }) {
    const instance = new this(client, info.uid);
    instance.nickname = info.nickname;
    instance.remark = info.remark;
    return instance;
  }

  async renew() {
    const data = await this.client.callApi('get_stranger_info', { user_id: this.uin });
    this.nickname = data.nickname;
    this.remark = data.remark;
    return data;
  }

  async sendFile(file: string, filename: string): Promise<string> {
    await this.client.callApi('upload_private_file', {
      user_id: this.uin,
      file,
      name: filename,
    });
    return filename;
  }
}

class NapCatGFS implements GroupFs {
  public constructor(private client: NapCatClient, private gid: number) {
  }

  async upload(file: string | Buffer | Uint8Array, pid?: string, name?: string, callback?: (percentage: string) => void) {
    if (typeof file !== 'string') {
      throw new Error('TODO');
    }
    return await this.client.callApi('upload_group_file', {
      group_id: this.gid,
      file,
      name,
      folder_id: pid,
    });
  }
}

export class NapCatGroup extends NapCatEntity implements Group {
  readonly dm = false;
  name: string;
  fs: GroupFs;

  is_owner = false;
  is_admin = false;

  private constructor(client: NapCatClient,
                      public readonly gid: number) {
    super(client);
    this.logger = getLogger(`NapCatGroup - ${client.id} - ${gid}`);
    this.fs = new NapCatGFS(client, gid);
  }

  public static async create(client: NapCatClient, gid: number) {
    const instance = new this(client, gid);
    await instance.renew();
    return instance;
  }

  public static createExisted(client: NapCatClient, info: { gid: number, name: string }) {
    const instance = new this(client, info.gid);
    instance.name = info.name;
    return instance;
  }

  async renew() {
    const data = await this.client.callApi('get_group_info', { group_id: this.gid });
    this.name = data.group_name;
    const memberData = await this.client.callApi('get_group_member_info', {
      group_id: this.gid,
      user_id: this.client.uin,
    });
    this.is_owner = memberData.role === 'owner';
    this.is_admin = memberData.role === 'admin';
    return data;
  }

  protected async sendMsgImpl(message: Send[keyof Send][], extra = {}): Promise<MessageRet> {
    const data = await this.client.callApi('send_group_msg', {
      group_id: this.gid,
      ...extra,
      // @ts-ignore 库的问题
      message,
    });
    return {
      message_id: data.message_id.toString(),
      seq: data.message_id,
      time: Date.now() / 1000,
      rand: 0,
    };
  }

  pickMember(uid: number, strict?: boolean): GroupMember {
    return new NapCatGroupMember(this.client, this.gid, uid);
  }

  async muteMember(uid: number, duration = 600): Promise<void> {
    await this.client.callApi('set_group_ban', {
      group_id: this.gid,
      user_id: uid,
      duration: duration,
    });
  }

  async setCard(uid: number, card?: string): Promise<boolean> {
    try {
      await this.client.callApi('set_group_card', {
        group_id: this.gid,
        user_id: uid,
        card: card,
      });
      return true;
    }
    catch (e) {
      this.logger.error('设置群名片失败', e);
      posthog.capture('NapCat 设置群名片失败', { error: e });
      return false;
    }
  }

  async getAllMemberInfo() {
    // lib bug
    return await this.client.callApi('get_group_member_list', { group_id: this.gid }) as unknown as WSSendReturn['get_group_member_info'][];
  }

  async announce(content: string): Promise<any> {
    return await this.client.callApi('_send_group_notice', {
      group_id: this.gid,
      content,
    });
  }

  async pokeMember(uid: number): Promise<boolean> {
    try {
      await this.client.callApi('group_poke', {
        group_id: this.gid,
        user_id: uid,
      });
      return true;
    }
    catch (e) {
      this.logger.error('戳一戳失败', e);
      posthog.capture('NapCat 戳一戳失败', { error: e });
      return false;
    }
  }

  override async getFileUrl(fid: string): Promise<string> {
    const data = await this.client.callApi('get_group_file_url', { group_id: this.gid, file_id: fid });
    return data.url;
  }
}

export class NapCatGroupMember extends NapCatUser implements GroupMember {
  public constructor(client: NapCatClient,
                     public readonly gid: number,
                     uid: number) {
    super(client, uid);
  }

  async renew() {
    return await this.client.callApi('get_group_member_info', {
      group_id: this.gid,
      user_id: this.uin,
    });
  }
}
