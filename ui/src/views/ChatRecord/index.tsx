import { defineComponent, ref, provide, watch } from 'vue';
import styles from './index.module.sass';
import { useBrowserLocation } from '@vueuse/core';
import Viewer from './Viewer';
import client from '@/utils/client';

export default defineComponent({
  setup() {
    const location = useBrowserLocation();
    const getInitialUuid = () => {
      const search = location.value.search || window.location.search;
      const params = new URLSearchParams(search);
      return params.get('tgWebAppStartParam') || '';
    };

    const currentUuid = ref(getInitialUuid());
    const historyStack = ref<Array<{ uuid: string; title?: string }>>([]);
    const loading = ref(true);
    const data = ref<any>(null);
    const error = ref<string>('');

    // 本地缓存加载过的层级记录，返回时无需再次请求
    const recordsCache = new Map<string, any>();

    const fetchMessages = async (targetUuid: string) => {
      if (!targetUuid) {
        error.value = '未指定消息记录 ID';
        loading.value = false;
        return;
      }
      if (recordsCache.has(targetUuid)) {
        data.value = recordsCache.get(targetUuid);
        loading.value = false;
        error.value = '';
        return;
      }
      loading.value = true;
      error.value = '';
      try {
        const result = await client.Q2tgServlet.GetForwardMultipleMessageApi.post({ uuid: targetUuid });
        if (result.data && !result.data.error) {
          data.value = result.data;
          recordsCache.set(targetUuid, result.data);
        } else {
          data.value = null;
          error.value = result.data?.error || result.error?.value?.message || result.error?.message || '获取记录失败';
        }
      } catch (e: any) {
        data.value = null;
        error.value = e.message || '网络请求错误';
      } finally {
        loading.value = false;
      }
    };

    const openForward = (targetUuid: string, title?: string) => {
      if (!targetUuid || targetUuid === currentUuid.value) return;
      historyStack.value.push({ uuid: currentUuid.value, title });
      currentUuid.value = targetUuid;
    };

    const goBack = () => {
      const prev = historyStack.value.pop();
      if (prev) {
        currentUuid.value = prev.uuid;
      }
    };

    provide('openForward', openForward);

    watch(currentUuid, (newUuid) => {
      fetchMessages(newUuid);
    }, { immediate: true });

    return () => {
      return (
        <div class={styles.container}>
          {historyStack.value.length > 0 && (
            <div class={styles.navBar}>
              <button class={styles.backButton} onClick={goBack}>
                <span class={styles.arrow}>⬅</span> 返回上一层 ({historyStack.value.length})
              </button>
            </div>
          )}
          {loading.value ? (
            <div class={styles.tip}>加载中...</div>
          ) : error.value || !data.value ? (
            <div class={styles.tip}>{error.value || '出错了'}</div>
          ) : (
            <Viewer messages={data.value} />
          )}
        </div>
      );
    };
  },
});
