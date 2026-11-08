import Instance from '../models/Instance';
import convert from '../helpers/convert';
import Telegram from '../client/Telegram';
import { Api } from 'telegram';
import BigInteger from 'big-integer';
import { getLogger } from 'log4js';
import fs from 'fs';
import { Elysia } from 'elysia';

const log = getLogger('telegramAvatar');

const userAvatarFileIdCache = new Map<string, BigInteger.BigInteger>();

const getUserAvatarFileId = async (tgBot: Telegram, userId: string) => {
  let cached = userAvatarFileIdCache.get(userId);
  if (cached) return cached;

  const user = await tgBot.getChat(userId);
  if ('photo' in user.entity && user.entity.photo instanceof Api.UserProfilePhoto) {
    cached = user.entity.photo.photoId;
  }
  else {
    cached = BigInteger.zero;
  }
  userAvatarFileIdCache.set(userId, cached);
  return cached;
};

const getUserAvatarPath = async (tgBot: Telegram, userId: string) => {
  const fileId = await getUserAvatarFileId(tgBot, userId);
  if (fileId.eq(0)) return '';
  return await convert.cachedBuffer(fileId.toString(16) + '.jpg', () => tgBot.downloadEntityPhoto(userId));
};

export default new Elysia()
  .get('/telegramAvatar/:instanceId/:userId', async ({ params, error, set }) => {
    log.debug('请求头像', params.userId);
    const instance = Instance.instances.find(it => it.id.toString() === params.instanceId);
    if (!instance || !instance.tgBot) {
      return error(404, 'Instance not found');
    }
    const avatar = await getUserAvatarPath(instance.tgBot, params.userId);

    if (!avatar) {
      return error(404);
    }

    set.headers['content-type'] = 'image/jpeg';
    return fs.createReadStream(avatar);
  });
