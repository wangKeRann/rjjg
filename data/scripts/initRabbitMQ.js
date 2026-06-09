#!/usr/bin/env node
/**
 * RabbitMQ 初始化脚本
 * 创建交换机、队列并绑定
 * 
 * 使用方式：
 *   node scripts/initRabbitMQ.js
 */

const amqp = require('amqplib');
const { simpleLogger as logger } = require('../src/logger');

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
const EXCHANGE_NAME = 'order_events';
const EXCHANGE_TYPE = 'topic';
const QUEUES = {
  orderPaid: { name: 'order_paid_queue', bindings: ['order.paid'] },
  stats: { name: 'stats_queue', bindings: ['order.*', 'price.updated'] },
  notification: { name: 'notification_queue', bindings: ['order.*'] },
};

async function initRabbitMQ() {
  let connection;
  let channel;
  
  try {
    logger.info('正在连接 RabbitMQ...', { url: RABBITMQ_URL.replace(/\/\/[^@]+@/, '//***@') });
    connection = await amqp.connect(RABBITMQ_URL);
    channel = await connection.createChannel();
    
    // 声明交换机
    await channel.assertExchange(EXCHANGE_NAME, EXCHANGE_TYPE, {
      durable: true,
      autoDelete: false,
    });
    logger.info(`交换机已创建: ${EXCHANGE_NAME} (${EXCHANGE_TYPE})`);
    
    // 声明队列并绑定
    for (const [key, queue] of Object.entries(QUEUES)) {
      await channel.assertQueue(queue.name, {
        durable: true,
        maxPriority: 10,
      });
      logger.info(`队列已创建: ${queue.name}`);
      
      for (const bindingKey of queue.bindings) {
        await channel.bindQueue(queue.name, EXCHANGE_NAME, bindingKey);
        logger.info(`绑定: ${queue.name} -> ${EXCHANGE_NAME}(${bindingKey})`);
      }
    }
    
    logger.info('RabbitMQ 初始化完成！');
    
    // 打印配置信息
    console.log('\n=== RabbitMQ 配置 ===');
    console.log(`交换机: ${EXCHANGE_NAME} (${EXCHANGE_TYPE})`);
    console.log('队列:');
    for (const [key, queue] of Object.entries(QUEUES)) {
      console.log(`  - ${queue.name}: ${queue.bindings.join(', ')}`);
    }
    console.log('\n管理界面: http://localhost:15672 (guest/guest)');
    
    await channel.close();
    await connection.close();
    
  } catch (error) {
    logger.error('初始化失败', { error: error.message });
    process.exit(1);
  }
}

if (require.main === module) {
  initRabbitMQ();
}

module.exports = { initRabbitMQ };