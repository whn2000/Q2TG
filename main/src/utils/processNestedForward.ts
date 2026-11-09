import { ForwardMessage } from '../client/QQClient';
import forwardHelper from '../helpers/forwardHelper';
import db from '../models/db';
import { setForwardCache } from '../api/q2tgServlet';

const processNestedForward = async (messages: ForwardMessage[], fromPairId: number) => {
  if (!Array.isArray(messages)) return;
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
          fileName = '';
        }
      }
      else if (elem.type === 'forward') {
        resId = (elem as any).id || (elem as any).resId || (elem as any).resid;
        fileName = (elem as any).fileName || '';
        if (Array.isArray((elem as any).content)) {
          nestedContent = (elem as any).content;
        }
      }

      if (resId) {
        let entity = await db.forwardMultiple.findFirst({ where: { resId } });
        if (!entity) {
          entity = await db.forwardMultiple.create({
            data: {
              resId,
              fileName,
              fromPairId,
            },
          });
        }
        (elem as any).uuid = entity.id;

        if (elem.type === 'json') {
          elem.data = JSON.stringify({ type: 'forward', uuid: entity.id, resId, fileName });
        }
        else if (elem.type === 'xml') {
          elem.type = 'forward';
          elem.data = JSON.stringify({ type: 'forward', uuid: entity.id, resId });
        }

        if (nestedContent) {
          setForwardCache(entity.id, nestedContent);
          await processNestedForward(nestedContent, fromPairId);
        }
      }
    }
  }
};

export default processNestedForward;
