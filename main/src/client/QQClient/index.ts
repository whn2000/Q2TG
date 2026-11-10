import { CreateOicqParams } from '../OicqClient';
import { Friend, Group, SendableElem } from './entity';
import {
  FriendIncreaseEvent,
  GroupMemberDecreaseEvent,
  GroupMemberIncreaseEvent, GroupNameChangeEvent, InputStatusChangeEvent,
  MessageEvent,
  MessageRecallEvent, PokeEvent,
} from './events';
import type { FriendRequestEvent, GroupInviteEvent, ImageElem } from '@icqqjs/icqq';
import { CreateNapCatParams } from '../NapCatClient';

export * from './events';
export * from './entity';

export interface CreateQQClientParamsBase {
  id: number;
}

export type CreateQQClientParams = CreateOicqParams | CreateNapCatParams;

export abstract class QQClient {
  protected constructor(
    // 数据库内 ID
    public readonly id: number,
  ) {
  }

  public abstract uin: number;
  public abstract nickname: string;

  public abstract isOnline(): Promise<boolean>;


  private static existedBots = {} as { [id: number]: Promise<QQClient> };

  public static create(params: CreateQQClientParams) {
    if (this.existedBots[params.id]) {
      return this.existedBots[params.id];
    }

    let client: Promise<QQClient>;
    let clientType: {
      create(params: CreateQQClientParams): Promise<QQClient>;
    };

    switch (params.type) {
      case 'oicq':
        clientType = require('../OicqClient').default;
        break;
      case 'napcat':
        clientType = require('../NapCatClient').NapCatClient;
        break;
      default:
        throw new Error('Unknown client type');
    }

    client = clientType.create(params);

    this.existedBots[params.id] = client;
    return client;
  }


  public abstract getFriendsWithCluster(): Promise<{
    name: string;
    friends: Friend[];
  }[]>;

  public abstract getGroupList(): Promise<Group[]>;

  public abstract getCustomFaceList(count?: number): Promise<Array<{
    url: string;
    md5?: string;
    desc?: string;
  }>>;


  protected async callHandlers<T>(handlers: Array<(e: T) => Promise<void | boolean>>, e: T) {
    for (const handler of handlers) {
      if (await handler(e)) return;
    }
  }

  // Offline & Online events
  protected readonly onOfflineHandlers: Array<(message: string) => Promise<void | boolean> | void> = [];
  protected readonly onOnlineHandlers: Array<() => Promise<void | boolean> | void> = [];

  public addOfflineEventHandler(handler: (message: string) => Promise<void | boolean> | void) {
    this.onOfflineHandlers.push(handler);
  }

  public removeOfflineEventHandler(handler: (message: string) => Promise<void | boolean> | void) {
    this.onOfflineHandlers.includes(handler) &&
    this.onOfflineHandlers.splice(this.onOfflineHandlers.indexOf(handler), 1);
  }

  public addOnlineEventHandler(handler: () => Promise<void | boolean> | void) {
    this.onOnlineHandlers.push(handler);
  }

  public removeOnlineEventHandler(handler: () => Promise<void | boolean> | void) {
    this.onOnlineHandlers.includes(handler) &&
    this.onOnlineHandlers.splice(this.onOnlineHandlers.indexOf(handler), 1);
  }

  // Handlers
  protected readonly onMessageHandlers: Array<(e: MessageEvent) => Promise<void | boolean>> = [];

  public addNewMessageEventHandler(handler: (e: MessageEvent) => Promise<void | boolean>) {
    this.onMessageHandlers.push(handler);
  }

  public removeNewMessageEventHandler(handler: (e: MessageEvent) => Promise<void | boolean>) {
    this.onMessageHandlers.includes(handler) &&
    this.onMessageHandlers.splice(this.onMessageHandlers.indexOf(handler), 1);
  }

  //
  protected readonly onGroupMemberIncreaseHandlers: Array<(e: GroupMemberIncreaseEvent) => Promise<void | boolean>> = [];

  public addGroupMemberIncreaseEventHandler(handler: (e: GroupMemberIncreaseEvent) => Promise<void | boolean>) {
    this.onGroupMemberIncreaseHandlers.push(handler);
  }

  public removeGroupMemberIncreaseEventHandler(handler: (e: GroupMemberIncreaseEvent) => Promise<void | boolean>) {
    this.onGroupMemberIncreaseHandlers.includes(handler) &&
    this.onGroupMemberIncreaseHandlers.splice(this.onGroupMemberIncreaseHandlers.indexOf(handler), 1);
  }

  //
  protected readonly onGroupMemberDecreaseHandlers: Array<(e: GroupMemberDecreaseEvent) => Promise<void | boolean>> = [];

  public addGroupMemberDecreaseEventHandler(handler: (e: GroupMemberDecreaseEvent) => Promise<void | boolean>) {
    this.onGroupMemberDecreaseHandlers.push(handler);
  }

  public removeGroupMemberDecreaseEventHandler(handler: (e: GroupMemberDecreaseEvent) => Promise<void | boolean>) {
    this.onGroupMemberDecreaseHandlers.includes(handler) &&
    this.onGroupMemberDecreaseHandlers.splice(this.onGroupMemberDecreaseHandlers.indexOf(handler), 1);
  }

  //
  protected readonly onFriendIncreaseHandlers: Array<(e: FriendIncreaseEvent) => Promise<void | boolean>> = [];

  public addFriendIncreaseEventHandler(handler: (e: FriendIncreaseEvent) => Promise<void | boolean>) {
    this.onFriendIncreaseHandlers.push(handler);
  }

  public removeFriendIncreaseEventHandler(handler: (e: FriendIncreaseEvent) => Promise<void | boolean>) {
    this.onFriendIncreaseHandlers.includes(handler) &&
    this.onFriendIncreaseHandlers.splice(this.onFriendIncreaseHandlers.indexOf(handler), 1);
  }

  //
  protected readonly onMessageRecallHandlers: Array<(e: MessageRecallEvent) => Promise<void | boolean>> = [];

  public addMessageRecallEventHandler(handler: (e: MessageRecallEvent) => Promise<void | boolean>) {
    this.onMessageRecallHandlers.push(handler);
  }

  public removeMessageRecallEventHandler(handler: (e: MessageRecallEvent) => Promise<void | boolean>) {
    this.onMessageRecallHandlers.includes(handler) &&
    this.onMessageRecallHandlers.splice(this.onMessageRecallHandlers.indexOf(handler), 1);
  }

  //
  protected readonly onPokeHandlers: Array<(e: PokeEvent) => Promise<void | boolean>> = [];

  public addPokeEventHandler(handler: (e: PokeEvent) => Promise<void | boolean>) {
    this.onPokeHandlers.push(handler);
  }

  public removePokeEventHandler(handler: (e: PokeEvent) => Promise<void | boolean>) {
    this.onPokeHandlers.includes(handler) &&
    this.onPokeHandlers.splice(this.onPokeHandlers.indexOf(handler), 1);
  }

  //
  protected readonly onFriendRequestHandlers: Array<(e: FriendRequestEvent) => Promise<void | boolean>> = [];

  public addFriendRequestEventHandler(handler: (e: FriendRequestEvent) => Promise<void | boolean>) {
    this.onFriendRequestHandlers.push(handler);
  }

  public removeFriendRequestEventHandler(handler: (e: FriendRequestEvent) => Promise<void | boolean>) {
    this.onFriendRequestHandlers.includes(handler) &&
    this.onFriendRequestHandlers.splice(this.onFriendRequestHandlers.indexOf(handler), 1);
  }

  //
  protected readonly onGroupInviteHandlers: Array<(e: GroupInviteEvent) => Promise<void | boolean>> = [];

  public addGroupInviteEventHandler(handler: (e: GroupInviteEvent) => Promise<void | boolean>) {
    this.onGroupInviteHandlers.push(handler);
  }

  public removeGroupInviteEventHandler(handler: (e: GroupInviteEvent) => Promise<void | boolean>) {
    this.onGroupInviteHandlers.includes(handler) &&
    this.onGroupInviteHandlers.splice(this.onGroupInviteHandlers.indexOf(handler), 1);
  }

  //
  protected readonly onInputStatusChangeHandlers: Array<(e: InputStatusChangeEvent) => Promise<void | boolean>> = [];

  public addInputStatusChangeHandler(handler: (e: InputStatusChangeEvent) => Promise<void | boolean>) {
    this.onInputStatusChangeHandlers.push(handler);
  }

  public removeInputStatusChangeHandler(handler: (e: InputStatusChangeEvent) => Promise<void | boolean>) {
    this.onInputStatusChangeHandlers.includes(handler) &&
    this.onInputStatusChangeHandlers.splice(this.onInputStatusChangeHandlers.indexOf(handler), 1);
  }

  //
  protected readonly onGroupNameChangeHandlers: Array<(e: GroupNameChangeEvent) => Promise<void | boolean>> = [];

  public addGroupNameChangeHandler(handler: (e: GroupNameChangeEvent) => Promise<void | boolean>) {
    this.onGroupNameChangeHandlers.push(handler);
  }

  public removeGroupNameChangeHandler(handler: (e: GroupNameChangeEvent) => Promise<void | boolean>) {
    this.onGroupNameChangeHandlers.includes(handler) &&
    this.onGroupNameChangeHandlers.splice(this.onGroupNameChangeHandlers.indexOf(handler), 1);
  }

  // End Handlers

  public getChat(roomId: number, tempChatFromGroupId?: number): Promise<Group | Friend> {
    if (roomId > 0) {
      return this.pickFriend(roomId, tempChatFromGroupId);
    }
    else {
      return this.pickGroup(-roomId);
    }
  }

  public abstract pickFriend(uin: number, tempChatFromGroupId?: number): Promise<Friend>;

  public abstract pickGroup(groupId: number): Promise<Group>;

  public async createSpoilerImageEndpoint(image: ImageElem, nickname: string, title?: string): Promise<SendableElem[]> {
    const res: SendableElem[] = [
      {
        type: 'text',
        text: '[Spoiler 图片]',
      },
      image,
    ];
    if (title) {
      res.push({
        type: 'text',
        text: title,
      });
    }
    return res;
  }
}
