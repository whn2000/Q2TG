import { Pair } from '../models/Pair';
import { SendableElem } from '../client/QQClient';
import { NapCatGroup } from '../client/NapCatClient';

export interface AtCandidate {
  user_id: number;
  name: string;
}

const memberCache = new Map<number, { time: number; list: AtCandidate[] }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache

export const atHelper = {
  /**
   * 获取群成员候选列表（带 5 分钟缓存）
   */
  async getGroupMemberCandidates(pair: Pair): Promise<AtCandidate[]> {
    if (!pair || !pair.qq || !('gid' in pair.qq)) {
      return [];
    }
    const gid = (pair.qq as any).gid;
    const cached = memberCache.get(gid);
    const now = Date.now();
    if (cached && now - cached.time < CACHE_TTL_MS) {
      return cached.list;
    }

    try {
      let list: AtCandidate[] = [];
      if (pair.qq instanceof NapCatGroup || typeof (pair.qq as any).getAllMemberInfo === 'function') {
        const rawMembers = await (pair.qq as any).getAllMemberInfo();
        if (Array.isArray(rawMembers)) {
          for (const m of rawMembers) {
            const name = (m.card || m.nickname || '').trim();
            if (name && m.user_id) {
              list.push({ user_id: Number(m.user_id), name });
            }
          }
        }
      }
      else if (typeof (pair.qq as any).getMemberList === 'function') {
        const rawMap = await (pair.qq as any).getMemberList();
        if (rawMap) {
          const arr = rawMap instanceof Map ? Array.from(rawMap.values()) : Object.values(rawMap);
          for (const m of arr as any[]) {
            const name = (m.card || m.nickname || '').trim();
            if (name && (m.user_id || m.uin)) {
              list.push({ user_id: Number(m.user_id || m.uin), name });
            }
          }
        }
      }

      // 按名字长度降序排序，优先匹配较长的昵称，避免短昵称贪婪匹配
      list.sort((a, b) => b.name.length - a.name.length);
      memberCache.set(gid, { time: now, list });
      return list;
    }
    catch {
      return cached?.list || [];
    }
  },

  /**
   * 将文本解析为包含 { type: 'at', qq: ... } 的消息链
   */
  parseTextWithAtMentions(text: string, candidates: AtCandidate[] = []): Array<string | SendableElem> {
    if (!text) return [];

    // 匹配前缀模式：必须位于字符串开头、空白字符或标点符号之后，防止误伤 email（如 foo@bar.com）
    // 支持：@all, @全体成员, @[5-11位QQ号], 以及候选成员名字
    const segments: Array<string | SendableElem> = [];
    let currentText = text;

    while (currentText.length > 0) {
      // 1. 查找最先出现的合法 @ 符号
      const atMatch = /(?:^|[\s,，。！!？?~～(（\[【])@/.exec(currentText);
      if (!atMatch) {
        segments.push(currentText);
        break;
      }

      const matchIndex = atMatch.index;
      // 前缀空白或标点
      const prefixLength = atMatch[0].length - 1; // 减去 '@' 自身的 1
      const atPos = matchIndex + prefixLength;

      // 把 @ 之前的文字加入 segments
      if (atPos > 0) {
        segments.push(currentText.substring(0, atPos));
      }

      const remaining = currentText.substring(atPos + 1); // '@' 之后的内容

      let matchedElem: SendableElem | null = null;
      let matchedLength = 0; // @ 之后匹配消耗的字符长度

      // (A) 优先匹配 @all 或 @全体成员
      const allMatch = /^(all|全体成员)(?:[\s,，。！!？?~～)）\]】]|$)/i.exec(remaining);
      if (allMatch) {
        matchedElem = {
          type: 'at',
          qq: 'all',
          text: `@${allMatch[1]}`,
        } as any;
        matchedLength = allMatch[1].length;
      }

      // (B) 匹配 QQ 号（5~11 位数字）
      if (!matchedElem) {
        const qqMatch = /^(\d{5,11})(?:[\s,，。！!？?~～)）\]】]|$)/.exec(remaining);
        if (qqMatch) {
          matchedElem = {
            type: 'at',
            qq: Number(qqMatch[1]),
            text: `@${qqMatch[1]}`,
          } as any;
          matchedLength = qqMatch[1].length;
        }
      }

      // (C) 匹配群成员昵称/名片
      if (!matchedElem && candidates.length > 0) {
        for (const candidate of candidates) {
          if (remaining.startsWith(candidate.name)) {
            matchedElem = {
              type: 'at',
              qq: candidate.user_id,
              text: `@${candidate.name}`,
            } as any;
            matchedLength = candidate.name.length;
            break;
          }
        }
      }

      if (matchedElem) {
        segments.push(matchedElem);
        currentText = remaining.substring(matchedLength);
      }
      else {
        // 没有匹配上有效的 @ 目标，保留 '@' 字符继续往下搜
        segments.push('@');
        currentText = remaining;
      }
    }

    // 合并相邻的 string 元素
    const merged: Array<string | SendableElem> = [];
    for (const item of segments) {
      if (typeof item === 'string') {
        if (merged.length > 0 && typeof merged[merged.length - 1] === 'string') {
          merged[merged.length - 1] += item;
        }
        else if (item.length > 0) {
          merged.push(item);
        }
      }
      else {
        merged.push(item);
      }
    }

    return merged;
  },
};

export default atHelper;
