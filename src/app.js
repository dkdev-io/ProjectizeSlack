import { App } from '@slack/bolt';
import dotenv from 'dotenv';

dotenv.config();

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

// Import handlers
import { handleMention } from './handlers/mention.js';
import { handleQuote } from './handlers/quote.js';
import { handleBatch, startRetryProcessor } from './handlers/batch.js';

// App mention handler - when @projectize is mentioned
app.event('app_mention', async ({ event, client, logger }) => {
  try {
    await handleMention({ event, client, logger });
  } catch (error) {
    logger.error('Error handling mention:', error);
  }
});

// Message handler - for quoted text and general processing
app.message(async ({ message, client, logger }) => {
  try {
    // Skip bot messages and messages older than 5 minutes
    if (message.subtype === 'bot_message') return;
    
    const messageAge = Date.now() - (message.ts * 1000);
    if (messageAge > 5 * 60 * 1000) return; // 5 minutes
    
    // Check for quoted text (lines starting with >)
    if (message.text && message.text.includes('>')) {
      await handleQuote({ message, client, logger });
    }
  } catch (error) {
    logger.error('Error handling message:', error);
  }
});

// Reaction added handler - for task approval/rejection
app.event('reaction_added', async ({ event, client, logger }) => {
  try {
    const { reaction, user, item } = event;
    
    // Handle task approval reactions
    if (reaction === 'white_check_mark' || reaction === 'x') {
      await handleBatch({ 
        action: reaction === 'white_check_mark' ? 'approve' : 'reject',
        messageTs: item.ts,
        channelId: item.channel,
        userId: user,
        client,
        logger
      });
    }
  } catch (error) {
    logger.error('Error handling reaction:', error);
  }
});

// App home opened - welcome message
app.event('app_home_opened', async ({ event, client, logger }) => {
  try {
    await client.views.publish({
      user_id: event.user,
      view: {
        type: 'home',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '🚀 *Welcome to Projectize!*\n\nI help extract actionable tasks from your conversations and sync them to Motion.\n\n*Getting Started:*\n• Invite me to a channel\n• Mention @projectize or quote text to extract tasks\n• Review and approve task previews\n• Tasks automatically sync to Motion'
            }
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: {
                  type: 'plain_text',
                  text: '🔗 Link Motion Account'
                },
                action_id: 'link_motion'
              }
            ]
          }
        ]
      }
    });
  } catch (error) {
    logger.error('Error publishing home view:', error);
  }
});

// Handle button clicks
app.action('link_motion', async ({ ack, body, client, logger }) => {
  await ack();
  
  try {
    await client.chat.postMessage({
      channel: body.user.id,
      text: '🔗 Motion account linking coming soon! For now, admin will configure Motion integration.'
    });
  } catch (error) {
    logger.error('Error handling link motion:', error);
  }
});

// Handle task approval/rejection buttons
app.action('approve_tasks', async ({ ack, body, client, logger }) => {
  await ack();
  
  try {
    await handleBatch({
      action: 'approve',
      messageTs: body.actions[0].value,
      channelId: body.channel.id,
      userId: body.user.id,
      client,
      logger
    });
  } catch (error) {
    logger.error('Error handling approve tasks:', error);
  }
});

app.action('reject_tasks', async ({ ack, body, client, logger }) => {
  await ack();
  
  try {
    await handleBatch({
      action: 'reject', 
      messageTs: body.actions[0].value,
      channelId: body.channel.id,
      userId: body.user.id,
      client,
      logger
    });
  } catch (error) {
    logger.error('Error handling reject tasks:', error);
  }
});

// Channel joined handler - setup flow
app.event('member_joined_channel', async ({ event, client, logger }) => {
  try {
    // Check if the bot was added to the channel
    const botInfo = await client.auth.test();
    
    if (event.user === botInfo.user_id) {
      await client.chat.postMessage({
        channel: event.channel,
        text: `Hi! I'm Projectize 🚀 I'll help extract tasks from conversations and sync them to Motion. Let me set up this channel...`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `Hi! I'm Projectize 🚀 I'll help extract tasks from conversations and sync them to Motion. Let me set up this channel...`
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*How to use:*\n• Mention @projectize or quote text with \`>\` to extract tasks\n• Review and approve task previews\n• Tasks automatically sync to Motion`
            }
          }
        ]
      });
    }
  } catch (error) {
    logger.error('Error handling channel join:', error);
  }
});

// Global error handler
app.error(async (error) => {
  console.error('Slack app error:', error);
});

// Start the app
(async () => {
  try {
    const port = process.env.PORT || 3000;
    await app.start(port);
    
    // Start background retry processor
    startRetryProcessor();
    
    console.log('⚡️ Projectize Slack app is running!');
    console.log(`🏠 Socket Mode enabled - no public endpoint needed`);
    console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`📋 Task retry processor started`);
  } catch (error) {
    console.error('Failed to start app:', error);
    process.exit(1);
  }
})();