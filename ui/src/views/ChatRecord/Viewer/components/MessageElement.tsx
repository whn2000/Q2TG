import { defineComponent, inject, type PropType } from 'vue';
import type { MessageElemExt } from '../types/MessageElemExt';
import styles from './MessageElement.module.sass';
import getImageUrlByMd5 from '../utils/getImageUrlByMd5';
import { NImage } from 'naive-ui';
import JsonElement from './JsonElement';
import XmlElement from './XmlElement';
import linkifyStr from 'linkify-string';

export default defineComponent({
  props: {
    elem: { required: true, type: Object as PropType<MessageElemExt> },
  },
  setup(props) {
    const openForward = inject<(uuid: string, title?: string) => void>('openForward', () => {});

    return () => {
      switch (props.elem.type) {
        case 'text':
        case 'face':
        case 'sface':
        case 'at':
          // will not xss
          return <div class={styles.messageContent} innerHTML={linkifyStr(props.elem.text || '', {
            nl2br: true,
            target: '_blank',
          })}></div>;
        case 'image':
        case 'flash': {
          let url = props.elem.url;
          let md5;
          if (!url && typeof props.elem.file === 'string') {
            md5 = props.elem.file.substring(0, 32);
            if (!/([a-f\d]{32}|[A-F\d]{32})/.test(md5))
              md5 = undefined;
            if (md5) {
              url = getImageUrlByMd5(md5);
            }
          }
          return <NImage
            class="mt-4px"
            width={200}
            src={url}
            imgProps={{ referrerpolicy: 'no-referrer' }}
          />;
        }
        case 'video-loop':
          return <video src={props.elem.url} autoplay muted loop width={200}/>;
        case 'tgs':
          return <tgs-player autoplay={true} loop={true} mode="normal" src={props.elem.url}
                             style={{ width: 200, height: 200 }}/>;
        case 'video':
          return <div>[视频]</div>;
        case 'record':
          if (props.elem.url) {
            return (
              <div class="my-1">
                <audio controls src={props.elem.url} class="max-w-240px block" />
              </div>
            );
          }
          return <div>🎙 [语音消息]</div>;
        case 'file':
          return <div>[文件] {props.elem.name}</div>;
        case 'location':
          return <div>[地址] {props.elem.name}<br/>{props.elem.address}</div>;
        case 'bface':
          let url = `https://gxh.vip.qq.com/club/item/parcel/item/${props.elem.file.substring(
            0,
            2,
          )}/${props.elem.file.substring(0, 32)}/300x300.png`;
          return <img src={url} alt={props.elem.text} referrerpolicy="no-referrer" width={200}/>;
        case 'rps':
          return <div>[猜拳]</div>;
        case 'dice':
          return <div>[骰子]</div>;
        case 'json':
          return <JsonElement json={props.elem.data}/>;
        case 'xml':
          return <XmlElement xml={props.elem.data}/>;
        case 'forward': {
          const uuid = (props.elem as any).uuid || (props.elem as any).id;
          const title = (props.elem as any).title || (props.elem as any).brief || '聊天记录 (合并转发)';
          return (
            <div
              class="c-blue-5 cursor-pointer font-500 hover:underline flex items-center gap-1 my-1"
              onClick={() => openForward(uuid, title)}
            >
              <span>📁</span>
              <span>[{title}]</span>
            </div>
          );
        }
        default:
          return <></>;
      }
    };
  },
});
