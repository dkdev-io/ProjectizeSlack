import claudeService from '../services/claude.js';
import supabaseService from '../services/supabase.js';
import { extractQuotedText } from '../utils/parser.js';

export async function handleQuote({ message, client, logger }) {
  const { text, user, channel, ts } = message;
  
  try {
    // Extract quoted content from message
    const quotedContent = extractQuotedText(text);
    
    if (!quotedContent || quotedContent.trim().length < 10) {
      return; // Not enough quoted content to process
    }
    
    // Check if message also mentions the bot
    const botMention = text.includes('<@') && text.includes(process.env.SLACK_BOT_USER_ID || 'projectize');
    
    if (!botMention) {
      return; // Only process quoted text if bot is mentioned
    }
    
    // Get context
    const channelInfo = await client.conversations.info({ channel });
    const userInfo = await client.users.info({ user });
    
    const context = {
      channelName: channelInfo.channel?.name || 'unknown',
      authorName: userInfo.user?.real_name || userInfo.user?.name || 'unknown'
    };
    
    // Extract tasks from quoted content
    const extractionResult = await claudeService.extractTasks(quotedContent, context);
    
    if (!extractionResult.success) {
      await client.chat.postMessage({
        channel,
        text: `⚠️ I had trouble processing the quoted text. Error: ${extractionResult.error}`,
        thread_ts: ts
      });
      return;
    }
    
    if (extractionResult.tasks.length === 0) {
      await client.chat.postMessage({
        channel,
        text: `🤔 I didn't find any actionable tasks in the quoted text.`,
        thread_ts: ts
      });
      return;
    }
    
    // Store and preview tasks
    await storeTaskPreview(ts, channel, user, extractionResult.tasks);
    await postQuotedTaskPreview(client, channel, extractionResult.tasks, quotedContent, ts);
    
  } catch (error) {
    logger.error('Error in handleQuote:', error);
    await client.chat.postMessage({
      channel,
      text: `❌ Error processing quoted text.`,
      thread_ts: message.ts
    });
  }
}

async function postQuotedTaskPreview(client, channel, tasks, quotedContent, threadTs) {
  // Truncate quoted content if too long
  const truncatedQuote = quotedContent.length > 200 
    ? quotedContent.substring(0, 200) + '...' 
    : quotedContent;
    
  const taskBlocks = tasks.map((task, index) => ({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*${index + 1}. ${task.title}*\n👤 ${task.assignee} ${task.due_date ? `| 📅 ${task.due_date}` : ''} ${task.confidence ? `| 🎯 ${task.confidence}` : ''}\n${task.context ? `_${task.context}_` : ''}`
    }
  }));
  
  await client.chat.postMessage({
    channel,
    thread_ts: threadTs,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `📋 *Found ${tasks.length} task${tasks.length > 1 ? 's' : ''} from quoted text:*`
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `> ${truncatedQuote}`
        }
      },
      ...taskBlocks,
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '✅ Create Tasks' },
            style: 'primary',
            action_id: 'approve_tasks',
            value: threadTs
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '❌ Cancel' },
            action_id: 'reject_tasks', 
            value: threadTs
          }
        ]
      }
    ]
  });
}

async function storeTaskPreview(messageTs, channelId, userId, tasks) {
  try {
    await supabaseService.addToTaskQueue({
      slack_message_ts: messageTs,
      slack_channel_id: channelId,
      slack_user_id: userId,
      extracted_tasks: tasks,
      status: 'pending'
    });
  } catch (error) {
    console.error('Failed to store quoted task preview:', error);
  }
}