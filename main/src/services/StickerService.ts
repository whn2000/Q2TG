import sharp from 'sharp';
import axios from 'axios';
import env from '../models/env';
import { getLogger, Logger } from 'log4js';
import sleep from '../utils/sleep';

export interface StickerItem {
  url: string;
  md5?: string;
  desc?: string;
}

export interface PreparedSticker {
  fileId: string;
  emoji: string;
}

export interface ImportStickersResult {
  total: number;
  success: number;
  failed: number;
  packs: Array<{
    name: string;
    title: string;
    link: string;
    count: number;
  }>;
}

const DEFAULT_EMOJIS = [
  '👍', '😀', '😂', '😍', '🤔', '😎', '🎉', '🔥', '✨', '🐱',
  '🥺', '🤣', '👌', '👏', '🥳', '😭', '🤤', '🫠', '🫡', '🙄',
  '💖', '💯', '🙏', '👀', '🤐', '😴', '🙃', '😇', '👻', '🌟',
];

const EMOJI_REGEX = /(\p{Emoji_Presentation}|\p{Extended_Pictographic})/u;

export default class StickerService {
  private readonly log: Logger = getLogger('StickerService');
  private readonly botToken = env.TG_BOT_TOKEN;

  private async callBotApi(method: string, body: any, isMultipart = false): Promise<any> {
    const url = `https://api.telegram.org/bot${this.botToken}/${method}`;
    let retries = 3;

    while (retries > 0) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: isMultipart ? undefined : { 'Content-Type': 'application/json' },
          body: isMultipart ? body : JSON.stringify(body),
        });
        const data = await res.json() as any;

        if (data.ok) {
          return data;
        }

        // Handle 429 Too Many Requests
        if (data.error_code === 429) {
          const waitSec = data.parameters?.retry_after || 5;
          this.log.warn(`[callBotApi] 429 Rate limited on ${method}, waiting ${waitSec + 1}s...`);
          await sleep((waitSec + 1) * 1000);
          retries--;
          continue;
        }

        this.log.warn(`[callBotApi] ${method} returned error:`, data);
        return data;
      }
      catch (e: any) {
        retries--;
        this.log.warn(`[callBotApi] Request error on ${method}:`, e.message);
        if (retries > 0) {
          await sleep(2000);
        }
        else {
          throw e;
        }
      }
    }
  }

  private pickEmoji(desc: string | undefined, index: number): string {
    if (desc) {
      const match = desc.match(EMOJI_REGEX);
      if (match && match[0]) {
        return match[0];
      }
    }
    return DEFAULT_EMOJIS[index % DEFAULT_EMOJIS.length];
  }

  private async convertImageToWebp(imageUrl: string): Promise<Buffer> {
    const res = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    const inputBuffer = Buffer.from(res.data);
    return await sharp(inputBuffer)
      .resize(512, 512, {
        fit: 'inside',
        withoutEnlargement: false,
      })
      .webp({ quality: 90 })
      .toBuffer();
  }

  private async uploadStickerFile(userId: number | string, webpBuffer: Buffer): Promise<string> {
    const formData = new FormData();
    formData.append('user_id', userId.toString());
    formData.append('sticker_format', 'static');
    formData.append('sticker', new Blob([webpBuffer], { type: 'image/webp' }), 'sticker.webp');

    const res = await this.callBotApi('uploadStickerFile', formData, true);
    if (!res.ok || !res.result?.file_id) {
      throw new Error(res.description || 'uploadStickerFile 失败');
    }
    return res.result.file_id;
  }

  public async importCustomFaces(
    userId: number | string,
    uin: number | string,
    instanceId: number,
    botUsername: string,
    faces: StickerItem[],
    onProgress?: (text: string) => Promise<void>,
  ): Promise<ImportStickersResult> {
    const total = faces.length;
    if (total === 0) {
      return { total: 0, success: 0, failed: 0, packs: [] };
    }

    const readyStickers: PreparedSticker[] = [];
    let failCount = 0;
    let completedCount = 0;
    let lastProgressTime = 0;

    const reportProgress = async (text: string, force = false) => {
      const now = Date.now();
      if (force || now - lastProgressTime > 2500) {
        lastProgressTime = now;
        try {
          await onProgress?.(text);
        }
        catch (_) {}
      }
    };

    await reportProgress(`🎨 准备处理 ${total} 个 QQ 收藏表情，正在转换并上传到 Telegram...`, true);

    // Concurrency pool (3 workers)
    const concurrency = 3;
    let nextIndex = 0;

    const worker = async () => {
      while (nextIndex < total) {
        const i = nextIndex++;
        const face = faces[i];
        try {
          const webpBuf = await this.convertImageToWebp(face.url);
          const fileId = await this.uploadStickerFile(userId, webpBuf);
          const emoji = this.pickEmoji(face.desc, i);
          readyStickers.push({ fileId, emoji });
        }
        catch (e: any) {
          this.log.warn(`[importCustomFaces] 处理第 ${i + 1} 个表情失败 (${face.url}):`, e.message);
          failCount++;
        }
        finally {
          completedCount++;
          const percent = Math.round((completedCount / total) * 100);
          await reportProgress(`🎨 正在转换上传表情: ${completedCount}/${total} (${percent}%)，已就绪: ${readyStickers.length} 个`);
        }
      }
    };

    const workers = Array.from({ length: concurrency }, () => worker());
    await Promise.all(workers);

    if (readyStickers.length === 0) {
      return { total, success: 0, failed: failCount, packs: [] };
    }

    // Split stickers into packs of max 120 (Telegram limit for static sets)
    const MAX_PER_PACK = 120;
    const packCount = Math.ceil(readyStickers.length / MAX_PER_PACK);
    const createdPacks: ImportStickersResult['packs'] = [];

    await reportProgress(`📦 表情上传完成（成功 ${readyStickers.length}，跳过 ${failCount}）。正在生成 ${packCount} 个表情包...`, true);

    for (let p = 0; p < packCount; p++) {
      const packNum = p + 1;
      const chunk = readyStickers.slice(p * MAX_PER_PACK, (p + 1) * MAX_PER_PACK);
      const packSuffix = packCount === 1 ? '' : `_${packNum}`;
      // Format: qq_fav_<packNum>_<uin>_by_<botUsername>
      const cleanBotName = botUsername.replace(/[^a-zA-Z0-9_]/g, '');
      const rawPackName = `qq_fav${packSuffix}_${uin}_by_${cleanBotName}`;
      const packName = rawPackName.replace(/[^a-zA-Z0-9_]/g, '_').replace(/_+/g, '_').slice(0, 64);
      const packTitle = packCount === 1 ? 'QQ 收藏表情' : `QQ 收藏表情 (${packNum})`;

      await reportProgress(`📦 正在生成表情包 [${packTitle}] (${chunk.length} 个表情)...`, true);

      // Delete existing set if present to cleanly overwrite
      try {
        await this.callBotApi('deleteStickerSet', { name: packName });
      }
      catch (_) {}

      // Initial batch of up to 50 stickers for createNewStickerSet
      const initialStickers = chunk.slice(0, 50).map(s => ({
        sticker: s.fileId,
        format: 'static',
        emoji_list: [s.emoji],
      }));

      const createRes = await this.callBotApi('createNewStickerSet', {
        user_id: Number(userId),
        name: packName,
        title: packTitle,
        sticker_format: 'static',
        stickers: initialStickers,
      });

      if (!createRes.ok) {
        this.log.error(`[importCustomFaces] 创建表情包 ${packName} 失败:`, createRes);
        continue;
      }

      // Add remaining stickers (from 50 onwards)
      for (let j = 50; j < chunk.length; j++) {
        const stk = chunk[j];
        await this.callBotApi('addStickerToSet', {
          user_id: Number(userId),
          name: packName,
          sticker: {
            sticker: stk.fileId,
            format: 'static',
            emoji_list: [stk.emoji],
          },
        });
        if (j % 10 === 0) {
          await reportProgress(`📦 表情包 [${packTitle}]: 已写入 ${j + 1}/${chunk.length} 个表情...`);
        }
        await sleep(100);
      }

      createdPacks.push({
        name: packName,
        title: packTitle,
        link: `https://t.me/addstickers/${packName}`,
        count: chunk.length,
      });
    }

    return {
      total,
      success: readyStickers.length,
      failed: failCount,
      packs: createdPacks,
    };
  }
}
