#!/usr/bin/env node
/**
 * Outbox 清理脚本
 * 清理过期的已发送事件
 * 
 * 使用方式：
 *   node scripts/cleanupOutbox.js [retentionHours]
 * 
 * 参数：
 *   retentionHours - 保留小时数，默认 24
 */

const { cleanupSentEvents } = require('../src/outboxService');
const { simpleLogger as logger } = require('../src/logger');

const retentionHours = parseInt(process.argv[2]) || 24;

logger.info(`开始清理 Outbox 事件（保留 ${retentionHours} 小时）`);
cleanupSentEvents(retentionHours);
logger.info('清理完成');