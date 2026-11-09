import type DateGroup from '../types/DateGroup';
import type SenderGroup from '../types/SenderGroup';
import { ForwardMessage } from '@icqqjs/icqq';
import { format } from 'date-fns';
import getUserAvatarUrl from './getUserAvatarUrl';

const USER_ID_PRIVATE = 1094950020;

export default function processHistory(history: ForwardMessage[]) {
  if (!Array.isArray(history)) return [];
  const data: DateGroup[] = [];
  let currentDateGroup: DateGroup | undefined;
  let currentSenderGroup: SenderGroup | undefined;
  for (let i = 0; i < history.length; i++) {
    const current = history[i];
    const time = current.time;
    const msgDate = new Date(time * 1000);
    if (!currentDateGroup || format(msgDate, 'yyyy/M/d') !== currentDateGroup.date) {
      // 推入所有数据
      if (currentSenderGroup)
        // 必有 currentDateGroup
        currentDateGroup!.messages.push(currentSenderGroup);
      if (currentDateGroup)
        data.push(currentDateGroup);
      currentSenderGroup = undefined;
      // 开始新的一天
      currentDateGroup = {
        date: format(msgDate, 'yyyy/M/d'),
        messages: [],
      };
    }
    let senderId = 0 as number | string, username = '', avatar = '';
    senderId = current.user_id === USER_ID_PRIVATE ? current.avatar || current.nickname : current.user_id;
    username = current.nickname;
    avatar = current.avatar || (Number(senderId) ? getUserAvatarUrl(Number(senderId)) : '');

    if (!currentSenderGroup || senderId !== currentSenderGroup.senderId) {
      if (currentSenderGroup) {
        // 不是一开始的情况
        currentDateGroup!.messages.push(currentSenderGroup);
      }
      // 开始一个新的发送者分组
      currentSenderGroup = {
        id: i,
        senderId,
        username,
        messages: [],
        avatar,
      };
    }
    currentSenderGroup.messages.push(current);
  }
  // 收工啦
  if (currentSenderGroup)
    currentDateGroup!.messages.push(currentSenderGroup);
  if (currentDateGroup)
    data.push(currentDateGroup);
  return data;
}
