import { Elysia, t } from 'elysia';
import db from '../../models/db';
import { Pair } from '../../models/Pair';
import OicqClient from '../../client/OicqClient';
import processNestedForward from '../../utils/processNestedForward';

export const forwardCache = new Map<string, any>();

export const setForwardCache = (uuid: string, data: any) => {
  forwardCache.set(uuid, data);
  const timer = setTimeout(() => {
    forwardCache.delete(uuid);
  }, 1000 * 60 * 5);
  timer?.unref?.();
};

let app = new Elysia()
  .post('/Q2tgServlet/GetForwardMultipleMessageApi', async ({ body }) => {
    // @ts-ignore
    const uuid = body.uuid;
    if (!forwardCache.has(uuid)) {
      const data = await db.forwardMultiple.findFirst({
        where: { id: uuid },
      });
      if (!data) {
        return { error: 'Record not found' };
      }
      const pair = Pair.getByDbId(data.fromPairId);
      if (!pair || !pair.qq) {
        return { error: 'Pair not found' };
      }
      let messages: any;
      try {
        messages = await pair.qq.getForwardMsg(data.resId, data.fileName);
      }
      catch (e: any) {
        return { error: 'Failed to fetch forward message: ' + e?.message };
      }
      if (!messages || !messages.length) {
        return { error: 'Message not found' };
      }
      if (pair.qqClient instanceof OicqClient) {
        await pair.qqClient.refreshImageRKey(messages);
      }
      await processNestedForward(messages, data.fromPairId);
      setForwardCache(uuid, messages);
    }
    return forwardCache.get(uuid);
  }, {
    body: t.Object({
      // 不许注入
      uuid: t.String({ format: 'uuid' }),
    }),
  });

export default app;
