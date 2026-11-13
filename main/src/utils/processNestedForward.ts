import crypto from 'crypto';
import { ForwardMessage } from '../client/QQClient';
import forwardHelper from '../helpers/forwardHelper';
import db from '../models/db';
import { setForwardCache } from '../api/q2tgServlet';
import { Pair } from '../models/Pair';
import OicqClient from '../client/OicqClient';

const processNestedForward = async (messages: ForwardMessage[], fromPairId: number) => {
  if (!Array.isArray(messages)) return;
  const pair = Pair.getByDbId(fromPairId);
  if (pair) {
    await forwardHelper.resolveForwardVideos(messages, pair);
    if (pair.qqClient instanceof OicqClient) {
      await pair.qqClient.refreshImageRKey(messages);
    }
  }

  for (const message of messages) {
    if (!message || !Array.isArray(message.message)) continue;
    for (const elem of message.message) {
      if (!elem) continue;

      let resId: string | undefined;
      let fileName = '';
      let nestedContent: ForwardMessage[] | undefined;

      if (elem.type === 'json' && typeof elem.data === 'string') {
        const parsed = forwardHelper.processJson(elem.data);
        if (parsed?.type === 'forward') {
          resId = parsed.resId;
          fileName = parsed.fileName || '';
        }
      }
      else if (elem.type === 'xml' && typeof elem.data === 'string') {
        const parsed = forwardHelper.processXml(elem.data);
        if (parsed?.type === 'forward') {
          resId = parsed.resId;
          fileName = (parsed as any).fileName || '';
        }
      }
      else if ((elem as any).type === 'forward') {
        resId = (elem as any).id || (elem as any).resId || (elem as any).resid;
        fileName = (elem as any).fileName || '';
        if (Array.isArray((elem as any).content)) {
          nestedContent = (elem as any).content;
        }
      }

      const validResId = resId && typeof resId === 'string' && resId.trim().length > 0 ? resId.trim() : '';
      if (validResId || nestedContent) {
        let entity = validResId ? await db.forwardMultiple.findFirst({ where: { resId: validResId } }) : null;
        if (!entity) {
          const finalResId = validResId || (nestedContent ? `nested_${crypto.randomUUID()}` : `fwd_${crypto.randomUUID()}`);
          entity = await db.forwardMultiple.create({
            data: {
              resId: finalResId,
              fileName,
              fromPairId,
            },
          });
        }
        (elem as any).uuid = entity.id;

        if (elem.type === 'json') {
          elem.data = JSON.stringify({ type: 'forward', uuid: entity.id, resId: entity.resId, fileName });
        }
        else if (elem.type === 'xml') {
          (elem as any).type = 'forward';
          elem.data = JSON.stringify({ type: 'forward', uuid: entity.id, resId: entity.resId });
        }

        if (nestedContent) {
          if (pair) {
            await forwardHelper.resolveForwardVideos(nestedContent, pair);
            if (pair.qqClient instanceof OicqClient) {
              await pair.qqClient.refreshImageRKey(nestedContent);
            }
          }
          setForwardCache(entity.id, nestedContent);
          await processNestedForward(nestedContent, fromPairId);
        }
      }
    }
  }
};

export default processNestedForward;
