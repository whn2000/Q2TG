import Instance from '../models/Instance';
import Telegram from '../client/Telegram';
import { Api } from 'telegram';
import { QQClient } from '../client/QQClient';
import OicqClient from '../client/OicqClient';

export default class AliveCheckController {
  constructor(private readonly instance: Instance,
              private readonly tgBot: Telegram,
              private readonly tgUser: Telegram,
              private readonly oicq: QQClient) {
    tgBot.addNewMessageEventHandler(this.handleMessage);
  }

  private handleMessage = async (message: Api.Message) => {
    const senderId = message.senderId || message.sender?.id;
    if (!senderId || !senderId.eq(this.instance.owner) || !message.isPrivate) {
      return false;
    }
    if (!['似了吗', '/alive'].includes(message.message)) {
      return false;
    }

    await message.reply({
      message: await this.genMessage(this.instance.id === 0 ? Instance.instances : [this.instance]),
    });
    return true;
  };

  private async genMessage(instances: Instance[]): Promise<string> {
    const boolToStr = (value: boolean) => {
      return value ? '好' : '坏';
    };
    const messageParts: string[] = [];

    for (const instance of instances) {
      const oicq = instance.oicq;
      const tgBot = instance.tgBot;
      const tgUser = instance.tgUser;

      const sign = oicq instanceof OicqClient ? await oicq.oicq.getSign('MessageSvc.PbSendMsg', 233, Buffer.alloc(10)) : null;

      const tgUserName = (tgUser.me.username || tgUser.me.usernames.length) ?
        '@' + (tgUser.me.username || tgUser.me.usernames[0].username) : tgUser.me.firstName;
      messageParts.push([
        `Instance #${instance.id} (${instance.workMode}) ${instance.isInit ? '' : '初始化未完成'}`,

        `QQ <code>${instance.qqUin}</code> (${oicq.constructor.name})\t` +
        `${boolToStr(await oicq.isOnline())}`,

        ...(oicq instanceof OicqClient ? [`签名服务器\t${boolToStr(sign.length > 0)}`] : []),

        `TG @${tgBot.me.username}\t${boolToStr(tgBot.isOnline)}`,

        `TG User ${tgUserName}\t${boolToStr(tgBot.isOnline)}`,
      ].join('\n'));
    }

    return messageParts.join('\n\n');
  };
}
