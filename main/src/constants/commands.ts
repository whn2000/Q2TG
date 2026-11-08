import { Api } from 'telegram';

const preSetupCommands = [
  new Api.BotCommand({
    command: 'setup',
    description: '执行初始化配置',
  }),
];

const commonPrivateCommands = [
  new Api.BotCommand({
    command: 'login',
    description: '当 QQ 处于下线状态时，使用此命令重新登录 QQ',
  }),
  new Api.BotCommand({
    command: 'flags',
    description: 'WARNING: EXPERIMENTAL FEATURES AHEAD!',
  }),
  new Api.BotCommand({
    command: 'alive',
    description: '状态信息',
  }),
]

// 这里的 group 指群组模式，Private 指在与机器人的私聊会话中
const groupPrivateCommands = [
  ...commonPrivateCommands,
  new Api.BotCommand({
    command: 'add',
    description: '添加新的群转发',
  }),
];

const personalPrivateCommands = [
  ...commonPrivateCommands,
  new Api.BotCommand({
    command: 'addfriend',
    description: '添加新的好友转发',
  }),
  new Api.BotCommand({
    command: 'addgroup',
    description: '添加新的群转发',
  }),
  new Api.BotCommand({
    command: 'import_all',
    description: '⚡ 一键批量导入所有未关联的好友与群组',
  }),
  new Api.BotCommand({
    command: 'import_friends',
    description: '⚡ 一键批量导入所有未关联的好友',
  }),
  new Api.BotCommand({
    command: 'import_groups',
    description: '⚡ 一键批量导入所有未关联的群组',
  }),
  new Api.BotCommand({
    command: 'refresh_all',
    description: '刷新所有头像和简介',
  }),
];

// 服务器零号实例的管理员
const groupPrivateSuperAdminCommands = [
  ...groupPrivateCommands,
  new Api.BotCommand({
    command: 'newinstance',
    description: '创建一个新的转发机器人实例',
  }),
];

const personalPrivateSuperAdminCommands = [
  ...personalPrivateCommands,
  new Api.BotCommand({
    command: 'newinstance',
    description: '创建一个新的转发机器人实例',
  }),
];

// inChat 表示在关联了的转发群组中的命令
const inChatCommands = [
  new Api.BotCommand({
    command: 'info',
    description: '查看本群或选定消息的详情',
  }),
  new Api.BotCommand({
    command: 'q',
    description: '生成 QuotLy 图片',
  }),
  new Api.BotCommand({
    command: 'rm',
    description: '在双端撤回被回复的消息',
  }),
  new Api.BotCommand({
    command: 'rmt',
    description: '在 TG 撤回被回复的消息',
  }),
  new Api.BotCommand({
    command: 'rmq',
    description: '在 QQ 撤回被回复的消息',
  }),
];

const groupInChatCommands = [
  ...inChatCommands,
  new Api.BotCommand({
    command: 'forwardoff',
    description: '暂停消息转发',
  }),
  new Api.BotCommand({
    command: 'forwardon',
    description: '恢复消息转发',
  }),
  new Api.BotCommand({ command: 'disable_qq_forward', description: '停止从QQ转发至TG' }),
  new Api.BotCommand({ command: 'enable_qq_forward', description: '恢复从QQ转发至TG' }),
  new Api.BotCommand({ command: 'disable_tg_forward', description: '停止从TG转发至QQ' }),
  new Api.BotCommand({ command: 'enable_tg_forward', description: '恢复从TG转发至QQ' }),
];

const personalInChatCommands = [
  ...inChatCommands,
  new Api.BotCommand({
    command: 'refresh',
    description: '刷新头像和简介',
  }),
  new Api.BotCommand({
    command: 'poke',
    description: '戳一戳',
  }),
  new Api.BotCommand({
    command: 'nick',
    description: '获取/设置群名片',
  }),
  new Api.BotCommand({
    command: 'mute',
    description: '设置 QQ 成员禁言',
  }),
];

export default {
  preSetupCommands,
  groupPrivateCommands,
  personalPrivateCommands,
  groupPrivateSuperAdminCommands,
  personalPrivateSuperAdminCommands,
  groupInChatCommands,
  personalInChatCommands,
};
