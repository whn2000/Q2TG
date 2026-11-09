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
  switch (data.type) {
    case 'text':
    case 'face':
    case 'image':
    case 'record':
    case 'json':
    case 'markdown':
      return {
        ...data.data,
        type: data.type,
        asface: 'sub_type' in data.data && parseInt(data.data.sub_type) > 0,
      } as any;
    // @ts-ignore
    case 'mface':
      return {
        type: 'image',
        url: (data as any).data.url,
        file: (data as any).data.url,
      };
    case 'at':
      const qqNum = Number(data.data.qq);
      return {
        type: data.type,
        qq: isNaN(qqNum) ? data.data.qq as any : qqNum,
      };
    case 'file':
      return {
        ...data.data,
        type: 'file',
        duration: 0,
        name: data.data.file,
        fid: data.data.file_id,
        size: Number(data.data.file_size),
        md5: '',
      };
    case 'video':
      return {
        type: data.type,
        // 我们不需要 fileId，直接能拿到 url，url 进 getVideoUrl 转一圈拿回来自己，保持兼容性
        fid: data.data.url,
        file: data.data.url,
      };
    case 'dice':
    case 'rps':
      return {
        id: Number(data.data.result),
        type: data.type,
      };
    case 'forward':
      return {
        type: 'forward',
        id: (data.data as any).id || (data.data as any).res_id || (data.data as any).resid || '',
        content: 'content' in data.data && Array.isArray((data.data as any).content)
          ? napCatForwardMultiple((data.data as any).content)
          : undefined,
      };
    case 'reply':
      return {
        type: 'reply',
        id: data.data.id,
      };
    default:
      throw new Error('不支持此元素');
  }
};

export const napCatForwardMultiple = (messages: WSSendReturn['get_forward_msg']['messages']): ForwardMessage[] => (messages || []).map(it => ({
  group_id: it.message_type === 'group' ? it.group_id : undefined,
  nickname: it.sender?.card || it.sender?.nickname || 'QQ用户',
  time: it.time || 0,
  user_id: it.sender?.user_id || 0,
  seq: it.message_id || 0,
  raw_message: it.raw_message || '',
  message: ((it as any).content || (it as any).message || []).map(napCatReceiveToMessageElem),
}));
