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
    const text = message.message ? message.message.trim().split('@')[0] : '';
    if (!['似了吗', '/alive'].includes(text)) {
      return false;
    }

    try {
      const replyMessage = await this.genMessage(this.instance.id === 0 ? Instance.instances : [this.instance]);
      await message.reply({ message: replyMessage });
    }
    catch (e) {
      try {
        await message.reply({
          message: `<b>存活检查遇到异常</b>\n<code>${e?.message || e}</code>\n\nTG Bot: 好\nQQ: 坏 (检查超时或异常)`,
        });
      }
      catch {
      }
    }
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

      let sign = null;
      try {
        if (oicq instanceof OicqClient) {
          sign = await oicq.oicq.getSign('MessageSvc.PbSendMsg', 233, Buffer.alloc(10));
        }
      }
      catch {}

      let qqOnline = false;
      try {
        qqOnline = !!oicq && await oicq.isOnline();
      }
      catch {}

      let tgBotOnline = false;
      try {
        tgBotOnline = !!tgBot?.isOnline;
      }
      catch {}

      let tgUserOnline = false;
      try {
        tgUserOnline = !!tgUser?.isOnline;
      }
      catch {}

      const tgUserName = (tgUser?.me?.username || tgUser?.me?.usernames?.length) ?
        '@' + (tgUser.me.username || tgUser.me.usernames[0].username) : (tgUser?.me?.firstName || 'UserBot');

      const lines = [
        `Instance #${instance.id} (${instance.workMode}) ${instance.isInit ? '' : '初始化未完成'}`,

        `QQ <code>${instance.qqUin || '未登录'}</code> (${oicq ? oicq.constructor.name : 'None'})\t` +
        `${boolToStr(qqOnline)}${qqOnline ? '' : ' (已掉线/离线)'}`,

        ...(oicq instanceof OicqClient ? [`签名服务器\t${boolToStr(sign && sign.length > 0)}`] : []),

        `TG @${tgBot?.me?.username || 'Bot'}\t${boolToStr(tgBotOnline)}`,

        `TG User ${tgUserName}\t${boolToStr(tgUserOnline)}`,
      ];

      if (!qqOnline) {
        lines.push(`\n<i>提示：QQ 机器人当前掉线。可私聊发送 /login 查看登录指引或登录 NapCat 控制台（端口 6099）重新扫码。</i>`);
      }

      messageParts.push(lines.join('\n'));
    }

    return messageParts.join('\n\n');
  };
}
