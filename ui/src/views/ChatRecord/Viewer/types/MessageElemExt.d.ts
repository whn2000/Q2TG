import { MessageElem, VideoElem } from "@icqqjs/icqq";

export type VideoElemExt = Omit<VideoElem, 'type'> & {
  type: 'video';
  url?: string;
  src?: string;
  thumb?: string;
  cover?: string;
};

export type MessageElemExt = MessageElem | VideoElemExt | {
  type: 'video-loop';
  url: string;
} | {
  type: 'tgs';
  url: string;
};
