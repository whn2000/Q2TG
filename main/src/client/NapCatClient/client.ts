import { CreateQQClientParamsBase, Friend, FriendIncreaseEvent, Group, GroupMemberDecreaseEvent, GroupMemberIncreaseEvent, GroupNameChangeEvent, InputStatusChangeEvent, MessageEvent, MessageRecallEvent, PokeEvent, QQClient, SendableElem } from '../QQClient';
import random from '../../utils/random';
import { getLogger, Logger } from 'log4js';
import posthog from '../../models/posthog';
import type { Receive, WSReceiveHandler, WSSendParam, WSSendReturn } from 'node-napcat-ts';
import { NapCatFriend, NapCatGroup } from './entity';
import { napCatReceiveToMessageElem } from './convert';
import { NapCatFriendRequestEvent, NapCatGroupEvent, NapCatGroupInviteEvent } from './event';
import type { ImageElem } from '@icqqjs/icqq';
import ReconnectingWebSocket from 'reconnecting-websocket';

export interface CreateNapCatParams extends CreateQQClientParamsBase {
  type: 'napcat';
  wsUrl: string;
}

export class NapCatClient extends QQClient {
  private _isWsConnected = false;
  private _isOnline = false;

  public get isWsConnected(): boolean {
    return this._isWsConnected;
  }

  private constructor(id: number, private readonly wsUrl: string) {
    super(id);
    this.logger = getLogger(`NapCatClient - ${id}`);
    this.ws = new ReconnectingWebSocket(wsUrl, [], {
      maxEnqueuedMessages: 100,
    });
    this.ws.onmessage = (e) => this.handleWebSocketMessage(e.data);
    this.ws.onopen = async () => {
      this._isWsConnected = true;
      this.logger.info('WS 连接成功');
      try {
        await this.refreshSelf();
        this._isOnline = true;
        await this.emitOnline();
      }
      catch (e) {
        this.logger.warn('NapCat WS 连接成功，但尚未完成 QQ 登录', e);
        this._isOnline = false;
        await this.emitOffline('NapCat 已连接，但 QQ 处于离线状态');
      }
    };
    this.ws.onclose = async (e) => {
      const wasOnline = this._isOnline;
      this._isWsConnected = false;
      this._isOnline = false;
      this.logger.warn(`NapCat WS 连接断开 (code: ${e?.code || 'unknown'})`);
      this.cleanupPendingCalls(new Error('NapCat WebSocket 连接已断开'));
      if (wasOnline) {
        await this.emitOffline('NapCat WebSocket 连接已断开');
      }
    };
    this.ws.onerror = (e) => {
      this.logger.error('NapCat WS 出错', e);
    };
  }

  private readonly ws: ReconnectingWebSocket;
  private readonly logger: Logger;

  public static async create(params: CreateNapCatParams) {
    const instance = new this(params.id, params.wsUrl);
    return new Promise<NapCatClient>((resolve, reject) => {
      const onInitialOpen = () => {
        cleanup();
        resolve(instance);
      };
      const onInitialError = (e: any) => {
        cleanup();
        instance.logger.error('WS 首次连接出错', e);
        posthog.capture('WS 连接出错', { error: e });
        reject(e);
      };
      const cleanup = () => {
        instance.ws.removeEventListener('open', onInitialOpen);
        instance.ws.removeEventListener('error', onInitialError);
      };
      instance.ws.addEventListener('open', onInitialOpen);
      instance.ws.addEventListener('error', onInitialError);
    });
  }

  private cleanupPendingCalls(err: Error) {
    for (const [echo, item] of this.echoMap.entries()) {
      if (item.timer) clearTimeout(item.timer);
      item.reject(err);
    }
    this.echoMap.clear();
  }

  private readonly echoMap = new Map<string, {
    resolve: (result: any) => void;
    reject: (result: any) => void;
    timer?: NodeJS.Timeout;
  }>();
  private echoSeq = 0;

  public async callApi<T extends keyof WSSendReturn>(action: T, params?: WSSendParam[T], timeoutMs = 30000): Promise<WSSendReturn[T]> {
    if (this.ws && typeof (this.ws as any).readyState === 'number' && (this.ws as any).readyState > 1) {
      return Promise.reject(new Error(`NapCat 未连接，无法调用 API [${action}]`));
    }
    return new Promise<WSSendReturn[T]>((resolve, reject) => {
      const echo = `${new Date().getTime()}-${this.echoSeq++}-${random.int(100000, 999999)}`;
      const timer = setTimeout(() => {
        if (this.echoMap.has(echo)) {
          this.echoMap.delete(echo);
          this.logger.warn(`API 调用超时 [${action}]: echo=${echo}`);
          reject(new Error(`NapCat API 调用超时 [${action}] (${timeoutMs}ms)`));
        }
      }, timeoutMs);

      this.echoMap.set(echo, { resolve, reject, timer });
      try {
        this.ws.send(JSON.stringify({ action, params, echo }));
        this.logger.debug('send', JSON.stringify({ action, params, echo }));
      }
      catch (err) {
        clearTimeout(timer);
        this.echoMap.delete(echo);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private async handleWebSocketMessage(message: string) {
    this.logger.debug('receive', message);
    const data = JSON.parse(message) as WSReceiveHandler[keyof WSReceiveHandler] & {
      echo: string;
      status: 'ok' | 'error';
      data: any;
      message: string;
      meta_event_type?: string;
      sub_type?: string;
    };
    if (data.echo) {
      const promise = this.echoMap.get(data.echo);
      if (!promise) return;
      if (promise.timer) clearTimeout(promise.timer);
      this.echoMap.delete(data.echo);
      if (data.status === 'ok') {
        promise.resolve(data.data);
      }
      else {
        promise.reject(new Error(data.message || `NapCat API 调用失败 [${data.status}]`));
      }
      return;
    }

    if (data.post_type === 'meta_event') {
      if (data.meta_event_type === 'heartbeat') {
        const isOnline = !!(data as any).status?.online;
        if (isOnline !== this._isOnline) {
          this._isOnline = isOnline;
          if (isOnline) {
            this.logger.info('NapCat 心跳检测：QQ 处于在线状态');
            await this.refreshSelf().catch(() => {});
            await this.emitOnline();
          }
          else {
            this.logger.warn('NapCat 心跳检测：QQ 处于离线状态');
            await this.emitOffline('NapCat 心跳报告 QQ 已离线');
          }
        }
      }
      else if (data.meta_event_type === 'lifecycle') {
        this.logger.info(`NapCat 生命周期事件: ${data.sub_type}`);
        if (data.sub_type === 'connect') {
          this._isWsConnected = true;
          await this.refreshSelf().catch(() => {});
        }
      }
      return;
    }
    if (data.post_type === 'message')
      await this.handleMessage(data);
    else if (data.post_type === 'notice' && data.notice_type === 'group_increase')
      await this.handleGroupIncrease(data);
    else if (data.post_type === 'notice' && data.notice_type === 'group_decrease')
      await this.handleGroupDecrease(data);
    else if (data.post_type === 'notice' && data.notice_type === 'friend_add')
      await this.handleFriendIncrease(data);
    else if (data.post_type === 'notice' && data.notice_type === 'friend_recall')
      await this.handleMessageRecall(data);
    else if (data.post_type === 'notice' && data.notice_type === 'group_recall')
      await this.handleMessageRecall(data);
    else if (data.post_type === 'notice' && data.notice_type === 'notify' && data.sub_type === 'poke')
      await this.handlePoke(data);
    else if (data.post_type === 'notice' && data.notice_type === 'notify' && data.sub_type === 'input_status')
      await this.handleInput(data);
    // @ts-ignore
    else if (data.post_type === 'notice' && data.notice_type === 'notify' && data.sub_type === 'group_name')
      await this.handleGroupNameChange(data);
    else if (data.post_type === 'request' && data.request_type === 'friend')
      await this.handleFriendRequest(data);
    else if (data.post_type === 'request' && data.request_type === 'group' && data.sub_type === 'invite')
      await this.handleGroupRequest(data);
  }

  public uin: number;
  public nickname: string;

  private async handleMessage(data: WSReceiveHandler['message']) {
    let chat: Friend | Group;
    if (data.message_type === 'private') {
      // sender 一定是对方
      chat = NapCatFriend.createExisted(this, { uid: data.user_id, remark: data.sender.card, nickname: data.sender.nickname });
    }
    else {
      // 上报没有群名
      chat = await this.pickGroup(data.group_id);
    }
    const message = (data.message as unknown as Receive[keyof Receive][]);
    const replyNode = message.find(it => it.type === 'reply');
    if (replyNode) {
      message.splice(message.indexOf(replyNode), 1);
    }
    const replyMessage = replyNode ? await this.getMessage(replyNode.data.id) : undefined;
    const event = new MessageEvent(
      { id: data.sender.user_id, card: data.sender.card, nickname: data.sender.nickname, name: data.sender.card || data.sender.nickname },
      chat,
      message.map(napCatReceiveToMessageElem),
      data.message_id,
      0, 0,
      data.time,
      data.raw_message,
      replyMessage ? {
        message: (replyMessage as any).message.filter(it => it.type !== 'reply').map(napCatReceiveToMessageElem),
        rand: 0, fromId: replyMessage.sender.user_id, seq: replyMessage.message_id, time: replyMessage.time,
      } : undefined,
      undefined,
      data.message_id.toString(),
      replyMessage?.sender.user_id === this.uin || message.some(it => it.type === 'at' && it.data.qq.toString() === this.uin.toString()),
      message.some(it => it.type === 'at' && (it.data.qq.toString() === '0' || !it.data.qq || it.data.qq === 'all')),
    );
    for (const handler of this.onMessageHandlers) {
      if (await handler(event)) {
        break;
      }
    }
  }

  private async handleGroupIncrease(data: WSReceiveHandler['notice.group_increase']) {
    const user = await this.callApi('get_stranger_info', { user_id: data.user_id });
    const event = new GroupMemberIncreaseEvent(await this.pickGroup(data.group_id), data.user_id, user.nickname);
    await this.callHandlers(this.onGroupMemberIncreaseHandlers, event);
  }

  private async handleGroupDecrease(data: WSReceiveHandler['notice.group_decrease']) {
    const event = new GroupMemberDecreaseEvent(await this.pickGroup(data.group_id), data.user_id, data.operator_id, false);
    await this.callHandlers(this.onGroupMemberDecreaseHandlers, event);
  }

  private async handleFriendIncrease(data: WSReceiveHandler['notice.friend_add']) {
    const event = new FriendIncreaseEvent(await NapCatFriend.create(this, data.user_id));
    await this.callHandlers(this.onFriendIncreaseHandlers, event);
  }

  private async handleMessageRecall(data: WSReceiveHandler['notice.friend_recall'] | WSReceiveHandler['notice.group_recall']) {
    const chat = data.notice_type === 'friend_recall' ? await this.pickFriend(data.user_id) : await this.pickGroup(data.group_id);
    const event = new MessageRecallEvent(chat, data.message_id, 0, data.time);
    await this.callHandlers(this.onMessageRecallHandlers, event);
  }

  private async handlePoke(data: WSReceiveHandler['notice.notify.poke.group'] | WSReceiveHandler['notice.notify.poke.friend']) {
    const nonSelfId = data.user_id === this.uin ? data.target_id : data.user_id;
    const chat = 'group_id' in data ? await this.pickGroup(data.group_id) : await this.pickFriend(nonSelfId);
    const operator = 'sender_id' in data ? data.sender_id as number : data.user_id;
    const nors: any[] = data.raw_info?.filter(it => (it.type as any) === 'nor') || [];
    const event = new PokeEvent(chat, operator, data.target_id, nors[0]?.txt, nors[1]?.txt);
    await this.callHandlers(this.onPokeHandlers, event);
  }

  private async handleInput(data: WSReceiveHandler['notice.notify.input_status']) {
    await this.callHandlers(this.onInputStatusChangeHandlers, new InputStatusChangeEvent(await this.pickFriend(data.user_id), !!data.status_text));
  }

  private async handleGroupNameChange(data: { group_id: number; user_id: number; name_new: string }) {
    const group = await this.pickGroup(data.group_id);
    await this.callHandlers(this.onGroupNameChangeHandlers, new GroupNameChangeEvent(group, group.pickMember(data.user_id), data.name_new));
  }

  private async handleFriendRequest(data: WSReceiveHandler['request.friend']) {
    const event = await NapCatFriendRequestEvent.create(this, data);
    await this.callHandlers(this.onFriendRequestHandlers, event);
  }

  private async handleGroupRequest(data: WSReceiveHandler['request.group']) {
    const event = await NapCatGroupEvent.create(this, data);
    // 上面过滤过了
    await this.callHandlers(this.onGroupInviteHandlers, event as NapCatGroupInviteEvent);
  }

  public async getMessage(messageId: number | string) {
    return await this.callApi('get_msg', { message_id: messageId as any });
  }

  public async refreshSelf() {
    const data = await this.callApi('get_login_info');
    this.uin = data.user_id;
    this.nickname = data.nickname;
  }

  public async isOnline(): Promise<boolean> {
    if (!this._isWsConnected && this.ws.readyState !== 1) {
      return false;
    }
    try {
      const data = await this.callApi('get_status', {}, 3000);
      this._isOnline = !!data?.online;
      return this._isOnline;
    }
    catch (e) {
      this.logger.warn('获取在线状态失败，判定为离线', e);
      this._isOnline = false;
      return false;
    }
  }

  private async emitOffline(msg: string) {
    for (const handler of this.onOfflineHandlers) {
      try {
        await handler(msg);
      }
      catch (e) {
        this.logger.error('触发 offline handler 出错', e);
      }
    }
  }

  private async emitOnline() {
    for (const handler of this.onOnlineHandlers) {
      try {
        await handler();
      }
      catch (e) {
        this.logger.error('触发 online handler 出错', e);
      }
    }
  }

  public async getFriendsWithCluster(): Promise<{ name: string; friends: Friend[]; }[]> {
    const data = await this.callApi('get_friends_with_category');
    if (!data || !Array.isArray(data) || data.length === 0) {
      return [];
    }
    if (data[0].buddyList === undefined) {
      const categories = new Map<number, { name: string; friends: Friend[]; }>();
      for (const _entry of data) {
        const it = _entry as any;
        let category = categories.get(it.categoryId);
        if (!category) {
          category = { name: it.categoryName || it.categroyName || '默认分组', friends: [] };
          categories.set(it.categoryId, category);
        }
        category.friends.push(NapCatFriend.createExisted(this, {
          nickname: it.nickname || it.nick || '',
          uid: Number(it.user_id ?? it.uin),
          remark: it.remark || '',
        }));
      }
      return Array.from(categories.values());
    }
    return data.map(it => ({
      name: it.categoryName || (it as any).categroyName || '默认分组', // typo in API
      friends: (it.buddyList || []).map(friend => NapCatFriend.createExisted(this, {
        nickname: friend.nickname || friend.nick || '',
        uid: Number(friend.user_id ?? friend.uin),
        remark: friend.remark || '',
      })),
    }));
  }

  public pickFriend(uin: number): Promise<Friend> {
    return NapCatFriend.create(this, uin);
  }

  public async getGroupList(): Promise<Group[]> {
    const data = await this.callApi('get_group_list');
    return data.map(it => NapCatGroup.createExisted(this, {
      gid: it.group_id,
      name: it.group_name,
    }));
  }

  public async getCustomFaceList(count = 1000): Promise<Array<{
    url: string;
    md5?: string;
    desc?: string;
  }>> {
    try {
      const res = await this.callApi('fetch_custom_face_detail' as any, { count });
      if (Array.isArray(res)) {
        return res.map((item: any) => ({
          url: item.url || '',
          md5: item.md5 || '',
          desc: item.desc || item.ocrWord || item.modifyWord || '',
        })).filter(x => !!x.url);
      }
      return [];
    }
    catch (e) {
      this.logger.warn('获取 QQ 收藏表情失败', e);
      return [];
    }
  }

  public pickGroup(groupId: number): Promise<Group> {
    return NapCatGroup.create(this, groupId);
  }

  override async createSpoilerImageEndpoint(image: ImageElem, nickname: string, title?: string): Promise<SendableElem[]> {
    const res: SendableElem[] = [
      {
        type: 'node',
        user_id: this.uin,
        nickname,
        message: image,
      },
    ];
    if (title) {
      res.push({
        type: 'node',
        user_id: this.uin,
        nickname,
        message: {
          type: 'text',
          text: title,
        },
      });
    }
    return res;
  }
}
