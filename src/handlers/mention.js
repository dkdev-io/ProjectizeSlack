import claudeService from '../services/claude.js';
import motionService from '../services/motion.js';
import supabaseService from '../services/supabase.js';
import { parseMessage } from '../utils/parser.js';

export async function handleMention({ event, client, logger }) {
  const { text, user, channel, ts } = event;
  
  try {
    // Get channel info for context
    const channelInfo = await client.conversations.info({ channel });
    const userInfo = await client.users.info({ user });
    
    // Parse the mention to extract the actual message content
    const { content, command } = parseMessage(text);
    
    if (command === 'help') {
      await sendHelpMessage(client, channel);
      return;
    }
    
    if (command === 'setup') {
      await handleChannelSetup(client, channel, channelInfo, user);
      return;
    }
    
    if (!content || content.trim().length < 10) {
      await client.chat.postMessage({
        channel,
        text: `Hi! I extract tasks from messages. Try:\n• \`@projectize [your message with tasks]\`\n• \`@projectize help\` for more info\n• \`@projectize setup\` to configure this channel`
      });
      return;
    }
    
    // Extract tasks using Claude
    const context = {
      channelName: channelInfo.channel?.name || 'unknown',
      authorName: userInfo.user?.real_name || userInfo.user?.name || 'unknown'
    };
    
    const extractionResult = await claudeService.extractTasks(content, context);
    
    if (!extractionResult.success) {
      await client.chat.postMessage({
        channel,
        text: `⚠️ Sorry, I had trouble processing that message. Error: ${extractionResult.error}`,
        thread_ts: ts
      });
      return;
    }
    
    if (extractionResult.tasks.length === 0) {
      await client.chat.postMessage({
        channel,
        text: `🤔 I didn't find any clear actionable tasks in that message. Try being more specific about who should do what and when.`,
        thread_ts: ts
      });
      return;
    }
    
    // Store tasks temporarily and post preview
    await storeTaskPreview(ts, channel, user, extractionResult.tasks);
    await postTaskPreview(client, channel, extractionResult.tasks, ts);
    
  } catch (error) {
    logger.error('Error in handleMention:', error);
    await client.chat.postMessage({
      channel,
      text: `❌ Sorry, something went wrong processing your request.`,
      thread_ts: event.ts
    });
  }
}

async function sendHelpMessage(client, channel) {
  await client.chat.postMessage({
    channel,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*🚀 Projectize Help*\n\nI help extract actionable tasks from your conversations and sync them to Motion.'
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*How to use:*\n• `@projectize [message]` - Extract tasks from your message\n• `@projectize setup` - Configure this channel\n• Quote text with `>` and mention me to extract from quoted content'
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Examples:*\n• "Jenny needs to finish the website by Tuesday"\n• "We should schedule the client call for next week"\n• "I\'ll handle the presentation slides before Friday"'
        }
      }
    ]
  });
}

async function handleChannelSetup(client, channel, channelInfo, userId) {
  try {
    // Check if channel is already mapped
    const existingMapping = await supabaseService.getChannelMapping(
      channel,
      channelInfo.channel?.team_id || 'unknown'
    );
    
    if (existingMapping) {
      await client.chat.postMessage({
        channel,
        text: `✅ This channel is already configured!\n📁 Motion Project: **${existingMapping.project_name || 'Not specified'}**\n\nUse \`@projectize setup\` to reconfigure if needed.`
      });
      return;
    }
    
    // Get suggested project mapping from Claude
    const channelName = channelInfo.channel?.name || 'unknown';
    const channelTopic = channelInfo.channel?.topic?.value || '';
    
    const suggestion = await claudeService.suggestProjectMapping(channelName, channelTopic);
    
    await client.chat.postMessage({
      channel,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `🔧 *Channel Setup*\n\nI think this channel maps to:\n📁 **${suggestion.workspace} > ${suggestion.project}**\n\n_${suggestion.reasoning}_`
          }
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: '✅ Confirm' },
              style: 'primary',
              action_id: 'confirm_mapping',
              value: JSON.stringify({
                workspace: suggestion.workspace,
                project: suggestion.project,
                channel: channel
              })
            },
            {
              type: 'button', 
              text: { type: 'plain_text', text: '✏️ Edit' },
              action_id: 'edit_mapping',
              value: channel
            }
          ]
        }
      ]
    });
    
  } catch (error) {
    console.error('Channel setup error:', error);
    await client.chat.postMessage({
      channel,
      text: `❌ Setup failed. Please try again or contact admin.`
    });
  }
}

async function postTaskPreview(client, channel, tasks, threadTs) {
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
          text: `📋 *Found ${tasks.length} task${tasks.length > 1 ? 's' : ''}:*`
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
    console.error('Failed to store task preview:', error);
  }
}