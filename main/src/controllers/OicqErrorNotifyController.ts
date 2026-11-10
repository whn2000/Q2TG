import Instance from '../models/Instance';
import OicqClient from '../client/OicqClient';
import { QQClient } from '../client/QQClient';
import flags from '../constants/flags';

export default class OicqErrorNotifyController {
  private locked = false;

  public constructor(private readonly instance: Instance,
                     private readonly oicq: QQClient) {
    if (oicq instanceof OicqClient) {
      oicq.oicq.on('system.offline', async ({ message }) => {
        await this.handleOffline(message);
      });
      oicq.oicq.on('system.online', async () => {
        await this.handleOnline();
      });
    }

    oicq.addOfflineEventHandler(async (message) => {
      await this.handleOffline(message);
    });

    oicq.addOnlineEventHandler(async () => {
      await this.handleOnline();
    });
  }

  private async handleOffline(message?: string) {
    if (this.locked) return;
    this.locked = true;
    if (!(this.instance.flags & flags.DISABLE_OFFLINE_NOTICE)) {
      try {
        await this.instance.ownerChat.sendMessage(
          `<i>QQ 机器人掉线</i>\n${message || '与 QQ 服务端连接断开或处于离线状态'}\n\n` +
          `提示：请检查 NapCat 状态或访问 NapCat Web 控制台（端口 6099）重新扫码登录。`
        );
      }
      catch {
      }
    }
  }

  private async handleOnline() {
    if (!this.locked) return;
    this.locked = false;
    if (!(this.instance.flags & flags.DISABLE_OFFLINE_NOTICE)) {
      try {
        await this.instance.ownerChat.sendMessage(`<i>QQ 机器人已恢复在线</i>`);
      }
      catch {
      }
    }
  }
}
