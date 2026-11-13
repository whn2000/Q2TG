import type { Receive, Send, WSSendReturn } from 'node-napcat-ts';
import { ForwardMessage, SendableElem } from '../QQClient';
import { ImageElem, MessageElem } from '@icqqjs/icqq';
import { file as createTempFileBase, FileResult } from 'tmp-promise';
import fsP from 'fs/promises';
import env from '../../models/env';
import fs from 'fs';
import path from 'path';
import { Readable } from 'node:stream';
import { FaceElem } from '@icqqjs/icqq/lib/message/elements';

const createTempFile = (options: Parameters<typeof createTempFileBase>[0] = {}) => createTempFileBase({
  tmpdir: env.CACHE_DIR,
  ...options,
});

export const messageElemToNapCatSendable = async (elem: SendableElem): Promise<{ elem: Send[keyof Send], tempFiles: FileResult[] }> => {
  const noTmp = (elem: Send[keyof Send]) => ({
    elem,
    tempFiles: [],
  });
  switch (elem.type) {
    case 'at':
      return noTmp({
        type: 'at',
        data: {
          qq: String((elem as any).qq),
        },
      } as any);
    case 'text':
    case 'face':
      return noTmp({
        type: elem.type,
        data: elem,
      } as any);
    case 'rps':
    case 'dice':
      return noTmp({
        type: elem.type,
        data: {
          result: elem.id,
        },
      });
    case 'image':
    case 'record':
    case 'video':
      const tempFiles: FileResult[] = [];
      const mediaPostfix = elem.type === 'record' ? '.silk' : (elem.type === 'image' ? '.png' : '.tmp');
      if (Buffer.isBuffer(elem.file)) {
        const file = await createTempFile({ postfix: mediaPostfix });
        tempFiles.push(file);
        await fsP.writeFile(file.path, elem.file);
        elem.file = file.path;
      }
      else if (typeof elem.file === 'object' && 'pipe' in elem.file) {
        const file = await createTempFile({ postfix: mediaPostfix });
        tempFiles.push(file);
        await new Promise((resolve, reject) => {
          const writeStream = fs.createWriteStream(file.path);
          writeStream.on('error', reject);
          writeStream.on('finish', resolve);
          (elem.file as Readable).pipe(writeStream);
        });
        elem.file = file.path;
      }
      if (typeof elem.file === 'string') {
        const normalizedFile = path.normalize(elem.file);
        const normalizedCacheDir = path.normalize(env.CACHE_DIR);
        if (normalizedFile.startsWith(normalizedCacheDir)) {
          const relativePath = path.relative(normalizedCacheDir, normalizedFile).replace(/\\/g, '/');
          elem.file = path.posix.join('/app/.config/QQ/NapCat/temp', relativePath);
        }
        else if (elem.file.includes('data\\cache\\') || elem.file.includes('data/cache/')) {
          const sub = elem.file.split(/data[\\/]cache[\\/]/)[1];
          if (sub) {
            elem.file = `/app/.config/QQ/NapCat/temp/${sub.replace(/\\/g, '/')}`;
          }
        }
      }
      if (!/^(https?|file):\/\//.test(elem.file) && elem.file.startsWith('/')) {
        elem.file = `file://${elem.file}`;
      }
      return {
        elem: {
          type: elem.type,
          data: {
            ...elem,
            file: elem.file,
            summary: ('brief' in elem && elem.brief) || env.IMAGE_SUMMARY || (`[Q2TG ${elem.type}]`),
            name: elem.type,
            sub_type: ('asface' in elem && elem.asface) ? 7 : 0,
          },
        } as any,
        tempFiles,
      };
    case 'node': {
      let message = elem.message;
      if (!Array.isArray(message)) {
        message = [message];
      }
      const forward = await Promise.all(message.map(it => messageElemToNapCatSendable(typeof it === 'string' ? { type: 'text', text: it } : it as SendableElem)));
      return {
        elem: {
          type: 'node',
          data: {
            user_id: elem.user_id,
            nickname: elem.nickname,
            content: forward.map(it => it.elem),
          },
        } as any,
        tempFiles: forward.flatMap(it => it.tempFiles),
      };
    }
    case 'sface':
    default:
      throw new Error('不支持此元素');
  }
};

export type NapCatForwardElem = {
  type: 'forward',
  id: string,
  content: ForwardMessage[],
}

export type FaceElemEx = FaceElem & {
  resultId?: string,
  chainCount?: number,
  stickerType?: number,
}

export type ImageElemEx = ImageElem & {
  brief?: string,
}

export const napCatReceiveToMessageElem = (data: Receive[keyof Receive]): MessageElem | NapCatForwardElem | FaceElemEx => {
  const elem = data as any;
  switch (elem.type) {
    case 'text':
    case 'face':
    case 'image':
    case 'record':
    case 'json':
    case 'markdown':
      return {
        ...elem.data,
        type: elem.type,
        asface: elem.data && 'sub_type' in elem.data && parseInt(elem.data.sub_type) > 0,
      } as any;
    // @ts-ignore
    case 'mface':
      return {
        type: 'image',
        url: elem.data?.url,
        file: elem.data?.url,
      } as any;
    case 'at':
      const qqNum = Number(elem.data?.qq);
      return {
        type: elem.type,
        qq: isNaN(qqNum) ? elem.data?.qq : qqNum,
      } as any;
    case 'file':
      return {
        ...elem.data,
        type: 'file',
        duration: 0,
        name: elem.data?.file,
        fid: elem.data?.file_id,
        size: Number(elem.data?.file_size),
        md5: '',
      } as any;
    case 'video': {
      const videoData = elem.data || {};
      const url = videoData.url || (/^https?:\/\//.test(videoData.file) ? videoData.file : '');
      const fid = videoData.url || videoData.file_id || videoData.file || '';
      return {
        ...videoData,
        type: 'video',
        fid,
        file: videoData.file || url,
        url,
      } as any;
    }
    case 'dice':
    case 'rps':
      return {
        id: Number(elem.data?.result),
        type: elem.type,
      } as any;
    case 'forward':
      return {
        type: 'forward',
        id: elem.data?.id || elem.data?.res_id || elem.data?.resid || '',
        content: elem.data?.content && Array.isArray(elem.data.content)
          ? napCatForwardMultiple(elem.data.content)
          : undefined,
      } as any;
    case 'node':
      return {
        type: 'forward',
        id: elem.data?.id || elem.data?.res_id || elem.data?.resid || '',
        content: Array.isArray(elem.data?.content)
          ? napCatForwardMultiple(elem.data.content)
          : undefined,
      } as any;
    case 'reply':
      return {
        type: 'reply',
        id: elem.data?.id,
      } as any;
    case 'location':
      return {
        type: 'location',
        ...elem.data,
      } as any;
    case 'xml':
      return {
        type: 'xml',
        data: elem.data?.data || '',
      } as any;
    case 'poke':
      return {
        type: 'poke',
        text: elem.data?.name || '戳一戳',
      } as any;
    case 'share':
      return {
        type: 'share',
        url: elem.data?.url || '',
        title: elem.data?.title || '',
      } as any;
    default:
      return {
        type: 'text',
        text: elem?.data?.text || elem?.text || `[${elem?.type || '未知消息'}]`,
      } as any;
  }
};

export const napCatForwardMultiple = (messages: any[]): ForwardMessage[] => (messages || []).map(it => {
  const data = it.data || it;
  const sender = it.sender || data.sender || {};
  let content = it.content || it.message || data.content || data.message;
  if (!content && it.type && it.type !== 'node') {
    content = [it];
  }
  const normalizedContent = Array.isArray(content) ? content : (content ? [content] : []);
  return {
    group_id: it.message_type === 'group' ? it.group_id : (data.group_id || undefined),
    nickname: sender.card || sender.nickname || data.nickname || data.card || data.name || it.nickname || 'QQ用户',
    time: it.time || data.time || 0,
    user_id: sender.user_id || data.user_id || data.uin || it.user_id || 0,
    seq: it.message_id || data.message_id || data.seq || it.seq || 0,
    raw_message: it.raw_message || data.raw_message || '',
    message: normalizedContent.map(napCatReceiveToMessageElem) as any,
  };
});
