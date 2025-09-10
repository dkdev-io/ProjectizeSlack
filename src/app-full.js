import pkg from '@slack/bolt';
const { App } = pkg;
import dotenv from 'dotenv';

dotenv.config();

// Import services
import claudeService from './services/claude.js';
import motionService from './services/motion.js';
import localStorageService from './services/local-storage.js';
import WorkspaceMatcherService from './services/workspace-matcher.js';
import { parseMessage, extractQuotedText } from './utils/parser.js';

const workspaceMatcher = new WorkspaceMatcherService(motionService);

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

// App mention handler - main task extraction
app.event('app_mention', async ({ event, client, logger }) => {
  try {
    const { text, user, channel, ts } = event;
    
    // Get context
    const channelInfo = await client.conversations.info({ channel });
    const userInfo = await client.users.info({ user });
    
    // Parse the message
    const { content, command } = parseMessage(text);
    
    if (command === 'help') {
      await client.chat.postMessage({
        channel,
        text: `🚀 *Projectize Help*\n\n• \`@projectize [message]\` - Extract tasks\n• \`@projectize help\` - Show this help\n• Quote text with \`>\` and mention me to extract from quotes\n\n*Example:* "I need to write labcorp a letter by Friday for the nastygram project"`
      });
      return;
    }
    
    if (!content || content.trim().length < 10) {
      await client.chat.postMessage({
        channel,
        text: `Hi! I extract tasks from messages. Try:\n• \`@projectize I need to finish the report by Friday\`\n• \`@projectize help\` for more info`
      });
      return;
    }
    
    // Extract tasks using Claude
    const context = {
      channelName: channelInfo.channel?.name || 'unknown',
      authorName: userInfo.user?.real_name || userInfo.user?.name || 'unknown'
    };
    
    await client.chat.postMessage({
      channel,
      text: `🔄 Analyzing your message for tasks...`,
      thread_ts: ts
    });
    
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
    
    // Get workspace suggestions
    const workspacesResult = await motionService.getWorkspaces();
    let workspaceSuggestions = [];
    
    if (workspacesResult.success && workspacesResult.workspaces?.length > 0) {
      workspaceSuggestions = await workspaceMatcher.suggestWorkspaceAndProject(
        extractionResult.tasks, 
        workspacesResult.workspaces
      );
    }
    
    // Store tasks with workspace suggestions
    await localStorageService.addToTaskQueue({
      slack_message_ts: ts,
      slack_channel_id: channel,
      slack_user_id: user,
      extracted_tasks: extractionResult.tasks,
      workspace_suggestions: workspaceSuggestions,
      status: 'pending'
    });
    
    // Build task preview with workspace suggestions
    const taskBlocks = extractionResult.tasks.map((task, index) => {
      const suggestion = workspaceSuggestions[index];
      let workspaceText = '';
      
      if (suggestion) {
        workspaceText = `\n📁 **${suggestion.workspace.name}**`;
        if (suggestion.project) {
          workspaceText += ` > ${suggestion.project.name}`;
        }
        workspaceText += ` (${suggestion.confidence} confidence)`;
        workspaceText += `\n💭 _${suggestion.reasoning}_`;
      }
      
      return {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${index + 1}. ${task.title}*\n👤 ${task.assignee} ${task.due_date ? `| 📅 ${task.due_date}` : ''} ${task.confidence ? `| 🎯 ${task.confidence}` : ''}\n${task.context ? `_${task.context}_` : ''}${workspaceText}`
        }
      };
    });
    
    await client.chat.postMessage({
      channel,
      thread_ts: ts,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `📋 *Found ${extractionResult.tasks.length} task${extractionResult.tasks.length > 1 ? 's' : ''}:*`
          }
        },
        ...taskBlocks,
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: '✅ Create in Motion' },
              style: 'primary',
              action_id: 'approve_tasks',
              value: ts
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: '❌ Cancel' },
              action_id: 'reject_tasks',
              value: ts
            }
          ]
        }
      ]
    });
    
  } catch (error) {
    logger.error('Error handling mention:', error);
    await client.chat.postMessage({
      channel: event.channel,
      text: `❌ Sorry, something went wrong: ${error.message}`,
      thread_ts: event.ts
    });
  }
});

// Handle task approval
app.action('approve_tasks', async ({ ack, body, client, logger }) => {
  await ack();
  
  try {
    const messageTs = body.actions[0].value;
    const channelId = body.channel.id;
    
    console.log(`🔘 Button clicked: approve_tasks for message ${messageTs}`);
    
    // Get stored tasks
    const storedTask = await localStorageService.getTaskByMessage(messageTs, channelId);
    
    if (!storedTask) {
      await client.chat.postMessage({
        channel: channelId,
        text: `❌ Could not find tasks to create.`,
        thread_ts: messageTs
      });
      return;
    }
    
    // Prevent duplicate processing
    if (storedTask.status !== 'pending') {
      await client.chat.postMessage({
        channel: channelId,
        text: `⚠️ Tasks already ${storedTask.status === 'completed' ? 'created' : 'being processed'}.`,
        thread_ts: messageTs
      });
      return;
    }
    
    // Update status
    await localStorageService.updateTaskQueue(storedTask.id, {
      status: 'processing'
    });
    
    // Post "creating tasks" message
    const processingMsg = await client.chat.postMessage({
      channel: channelId,
      text: `🔄 Creating ${storedTask.extracted_tasks.length} task${storedTask.extracted_tasks.length > 1 ? 's' : ''} in Motion...`,
      thread_ts: messageTs
    });
    
    // Use workspace suggestions from stored task
    const workspaceSuggestions = storedTask.workspace_suggestions || [];
    
    if (workspaceSuggestions.length === 0) {
      await client.chat.update({
        channel: channelId,
        ts: processingMsg.ts,
        text: `⚠️ No workspace suggestions available.`
      });
      return;
    }
    
    // Create tasks using suggested workspaces
    const motionResults = [];
    
    console.log(`📊 Processing ${storedTask.extracted_tasks.length} tasks with ${workspaceSuggestions.length} suggestions`);
    
    for (let i = 0; i < storedTask.extracted_tasks.length; i++) {
      const task = storedTask.extracted_tasks[i];
      const suggestion = workspaceSuggestions[i];
      
      if (!suggestion) {
        console.log(`⚠️ No suggestion for task ${i}: ${task.title}`);
        continue;
      }
      
      const workspaceId = suggestion.workspace.id;
      const projectId = suggestion.project?.id || null;
      
      console.log(`🎯 [${i+1}/${storedTask.extracted_tasks.length}] Creating task "${task.title}"`);
      console.log(`   Workspace: ${suggestion.workspace.name} (${workspaceId})`);
      if (projectId) {
        console.log(`   Project: ${suggestion.project.name} (${projectId})`);
      } else {
        console.log(`   Project: None`);
      }
      
      const result = await motionService.createTask(task, { 
        workspaceId, 
        projectId 
      });
      
      console.log(`   Result: ${result.success ? 'SUCCESS' : 'FAILED'} - ${result.success ? result.motionTaskId : result.error}`);
      
      motionResults.push(result);
      
      // Small delay between task creations
      if (i < storedTask.extracted_tasks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    // Combine results
    const successful = motionResults.filter(r => r.success).length;
    const failed = motionResults.filter(r => !r.success).length;
    const motionResult = {
      success: successful > 0,
      successful,
      failed,
      results: motionResults
    };
    
    if (motionResult.success) {
      await localStorageService.updateTaskQueue(storedTask.id, {
        status: 'completed'
      });
      
      await localStorageService.addTaskHistory({
        slack_message_ts: messageTs,
        slack_channel_id: channelId,
        original_message: JSON.stringify(storedTask.extracted_tasks),
        extracted_tasks: storedTask.extracted_tasks,
        motion_task_ids: motionResult.results.filter(r => r.success).map(r => r.motionTaskId),
        success: true
      });
      
      await client.chat.update({
        channel: channelId,
        ts: processingMsg.ts,
        text: `✅ Successfully created ${motionResult.successful} task${motionResult.successful > 1 ? 's' : ''} in Motion!${motionResult.failed > 0 ? `\n⚠️ ${motionResult.failed} task${motionResult.failed > 1 ? 's' : ''} failed to sync.` : ''}`,
      });
      
    } else {
      await localStorageService.updateTaskQueue(storedTask.id, {
        status: 'failed',
        error_message: 'Motion API error'
      });
      
      await client.chat.update({
        channel: channelId,
        ts: processingMsg.ts,
        text: `⚠️ Failed to sync tasks to Motion. Error: ${motionResult.error || 'Unknown error'}`
      });
    }
    
  } catch (error) {
    logger.error('Error approving tasks:', error);
  }
});

// Handle task rejection
app.action('reject_tasks', async ({ ack, body, client, logger }) => {
  await ack();
  
  try {
    const messageTs = body.actions[0].value;
    const channelId = body.channel.id;
    
    const storedTask = await localStorageService.getTaskByMessage(messageTs, channelId);
    
    if (storedTask) {
      await localStorageService.updateTaskQueue(storedTask.id, {
        status: 'failed',
        error_message: 'Rejected by user'
      });
    }
    
    await client.chat.postMessage({
      channel: channelId,
      text: `❌ Tasks cancelled.`,
      thread_ts: messageTs
    });
    
  } catch (error) {
    logger.error('Error rejecting tasks:', error);
  }
});

// App home
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
              text: '🚀 *Welcome to Projectize!*\n\nI help extract actionable tasks from your conversations and sync them to Motion.\n\n*How to use:*\n• Mention @projectize with your message\n• Review and approve task previews\n• Tasks automatically sync to Motion'
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*Example:*\n"@projectize I need to write labcorp a letter by Friday for the nastygram project"'
            }
          }
        ]
      }
    });
  } catch (error) {
    logger.error('Error publishing home view:', error);
  }
});

app.error(async (error) => {
  console.error('Slack app error:', error);
});

// Start the app
(async () => {
  try {
    const port = process.env.PORT || 3000;
    await app.start(port);
    
    console.log('⚡️ Projectize Full App is running!');
    console.log('🧠 Claude AI: Connected');
    console.log('🎯 Motion API: Connected'); 
    console.log('💾 Storage: Local files');
    console.log('🏠 Socket Mode enabled');
    console.log('\n🎉 Ready for task extraction!');
    console.log('Try: @projectize I need to finish the report by Friday');
    
    // Show debug info
    setTimeout(async () => {
      await localStorageService.showDebugInfo();
    }, 1000);
    
  } catch (error) {
    console.error('Failed to start app:', error);
    process.exit(1);
  }
})();