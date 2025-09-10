import pkg from '@slack/bolt';
const { App } = pkg;
import dotenv from 'dotenv';

dotenv.config();

// Import services
import claudeService from './services/claude.js';
import motionService from './services/motion.js';
import localStorageService from './services/local-storage.js';
import WorkspaceMatcherService from './services/workspace-matcher.js';
import ConversationAnalyzerService from './services/conversation-analyzer.js';
import { parseMessage, extractQuotedText, parseTaskEditCommand } from './utils/parser.js';

const workspaceMatcher = new WorkspaceMatcherService(motionService);
const conversationAnalyzer = new ConversationAnalyzerService(claudeService);

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
        text: `🚀 *Projectize Help*\n\n• \`@projectize\` - Analyze conversation history for tasks\n• \`@projectize [message]\` - Extract tasks from specific message\n• \`@projectize help\` - Show this help\n\n*Example:* Just mention me and I'll analyze recent conversation for actionable tasks!`
      });
      return;
    }
    
    // Determine extraction method
    let extractionResult;
    let analysisType;
    
    // If no specific content, analyze conversation history
    if (!content || content.trim().length < 10) {
      await client.chat.postMessage({
        channel,
        text: `🔄 Analyzing recent conversation history for tasks...`,
        thread_ts: ts
      });
      
      // Get bot user ID for mention detection
      const botInfo = await client.auth.test();
      
      // Analyze conversation history
      const historyResult = await conversationAnalyzer.analyzeConversationHistory(
        client, channel, ts, botInfo.user_id
      );
      
      if (!historyResult.success) {
        await client.chat.postMessage({
          channel,
          text: `⚠️ Error analyzing conversation: ${historyResult.error}`,
          thread_ts: ts
        });
        return;
      }
      
      if (historyResult.tasks.length === 0) {
        await client.chat.postMessage({
          channel,
          text: `🤔 No actionable tasks found in recent conversation (${historyResult.messagesAnalyzed} messages analyzed over ${historyResult.timeRange}).`,
          thread_ts: ts
        });
        return;
      }
      
      extractionResult = {
        success: true,
        tasks: historyResult.tasks,
        source: 'conversation_history',
        messagesAnalyzed: historyResult.messagesAnalyzed,
        timeRange: historyResult.timeRange
      };
      analysisType = `conversation history (${historyResult.messagesAnalyzed} messages over ${historyResult.timeRange})`;
      
    } else {
      // Extract tasks from the specific mention message
      await client.chat.postMessage({
        channel,
        text: `🔄 Analyzing your message for tasks...`,
        thread_ts: ts
      });
      
      extractionResult = await claudeService.extractTasks(content, context);
      
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
      
      analysisType = 'direct message';
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
            text: `📋 *Found ${extractionResult.tasks.length} task${extractionResult.tasks.length > 1 ? 's' : ''} from ${analysisType}:*`
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
              text: { type: 'plain_text', text: '✏️ Edit Tasks' },
              action_id: 'edit_tasks',
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

// Message handler for task edits (replies to edit requests)
app.message(async ({ message, client, logger }) => {
  try {
    // Skip bot messages 
    if (message.subtype === 'bot_message') return;
    
    // Check if this is a reply to an edit request
    if (message.thread_ts) {
      await handleTaskEditReply(message, client, logger);
    }
    
  } catch (error) {
    logger.error('Error handling message:', error);
  }
});

async function handleTaskEditReply(message, client, logger) {
  try {
    const { text, thread_ts, channel, user } = message;
    
    // Check if there's a task in editing state for this thread
    const storedTask = await localStorageService.getTaskByMessage(thread_ts, channel);
    
    if (!storedTask || storedTask.status !== 'editing') {
      return; // Not an edit reply
    }
    
    console.log(`✏️ Processing edit request: "${text}"`);
    
    // Parse edit commands
    const editCommands = parseTaskEditCommands(text);
    
    if (editCommands.length === 0) {
      await client.chat.postMessage({
        channel,
        text: `❓ I didn't understand that edit. Try:\n• \`Remove task 2\`\n• \`Change task 1 assignee to Jenny\`\n• \`Update task 1 due date to Monday\``,
        thread_ts: thread_ts
      });
      return;
    }
    
    // Apply edits to tasks
    let editedTasks = [...storedTask.extracted_tasks];
    let editedSuggestions = [...(storedTask.workspace_suggestions || [])];
    
    for (const command of editCommands) {
      const result = applyEditCommand(command, editedTasks, editedSuggestions);
      editedTasks = result.tasks;
      editedSuggestions = result.suggestions;
    }
    
    // Filter out removed tasks
    const validTasks = editedTasks.filter(task => task !== null);
    const validSuggestions = editedSuggestions.filter((_, index) => editedTasks[index] !== null);
    
    if (validTasks.length === 0) {
      await client.chat.postMessage({
        channel,
        text: `🗑️ All tasks removed. Use @projectize again to re-analyze.`,
        thread_ts: thread_ts
      });
      
      await localStorageService.updateTaskQueue(storedTask.id, {
        status: 'failed',
        error_message: 'All tasks removed by user'
      });
      return;
    }
    
    // Update stored task with edits
    await localStorageService.updateTaskQueue(storedTask.id, {
      extracted_tasks: validTasks,
      workspace_suggestions: validSuggestions,
      status: 'pending' // Back to pending for approval
    });
    
    // Re-generate workspace suggestions if needed
    if (editCommands.some(cmd => cmd.action === 'change_workspace')) {
      const workspacesResult = await motionService.getWorkspaces();
      if (workspacesResult.success) {
        const newSuggestions = await workspaceMatcher.suggestWorkspaceAndProject(validTasks, workspacesResult.workspaces);
        
        await localStorageService.updateTaskQueue(storedTask.id, {
          workspace_suggestions: newSuggestions
        });
        
        validSuggestions = newSuggestions;
      }
    }
    
    // Post updated preview
    await postUpdatedTaskPreview(client, channel, validTasks, validSuggestions, thread_ts, editCommands);
    
  } catch (error) {
    logger.error('Error handling task edit reply:', error);
  }
}

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

// Handle task editing
app.action('edit_tasks', async ({ ack, body, client, logger }) => {
  await ack();
  
  try {
    const messageTs = body.actions[0].value;
    const channelId = body.channel.id;
    
    await client.chat.postMessage({
      channel: channelId,
      text: `✏️ **Edit Tasks**\n\nReply to this message with your edits. Examples:\n• \`Remove task 2\`\n• \`Change task 1 assignee to Jenny\`\n• \`Update task 1 due date to Monday\`\n• \`Change task 2 workspace to DKC/Product\`\n\nI'll process your edits and show an updated proposal.`,
      thread_ts: messageTs
    });
    
    // Mark the task as "editing" so we can detect replies
    const storedTask = await localStorageService.getTaskByMessage(messageTs, channelId);
    if (storedTask) {
      await localStorageService.updateTaskQueue(storedTask.id, {
        status: 'editing'
      });
    }
    
  } catch (error) {
    logger.error('Error handling edit tasks:', error);
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

// Utility functions for task editing
function parseTaskEditCommands(text) {
  const commands = [];
  const lowerText = text.toLowerCase();
  
  // Remove task X
  const removeMatch = lowerText.match(/remove\s+task\s+(\d+)/);
  if (removeMatch) {
    commands.push({
      action: 'remove',
      taskIndex: parseInt(removeMatch[1]) - 1
    });
  }
  
  // Change task X assignee to Y
  const assigneeMatch = text.match(/change\s+task\s+(\d+)\s+assignee\s+to\s+(.+)/i);
  if (assigneeMatch) {
    commands.push({
      action: 'change_assignee',
      taskIndex: parseInt(assigneeMatch[1]) - 1,
      newValue: assigneeMatch[2].trim()
    });
  }
  
  // Update task X due date to Y
  const dueDateMatch = text.match(/(?:update|change)\s+task\s+(\d+)\s+(?:due\s+)?date\s+to\s+(.+)/i);
  if (dueDateMatch) {
    commands.push({
      action: 'change_due_date',
      taskIndex: parseInt(dueDateMatch[1]) - 1,
      newValue: dueDateMatch[2].trim()
    });
  }
  
  // Change task X workspace to Y
  const workspaceMatch = text.match(/change\s+task\s+(\d+)\s+workspace\s+to\s+(.+)/i);
  if (workspaceMatch) {
    commands.push({
      action: 'change_workspace',
      taskIndex: parseInt(workspaceMatch[1]) - 1,
      newValue: workspaceMatch[2].trim()
    });
  }
  
  return commands;
}

function applyEditCommand(command, tasks, suggestions) {
  const newTasks = [...tasks];
  const newSuggestions = [...suggestions];
  
  const { action, taskIndex, newValue } = command;
  
  if (taskIndex < 0 || taskIndex >= newTasks.length) {
    return { tasks: newTasks, suggestions: newSuggestions };
  }
  
  switch (action) {
    case 'remove':
      newTasks[taskIndex] = null; // Mark for removal
      break;
      
    case 'change_assignee':
      if (newTasks[taskIndex]) {
        newTasks[taskIndex] = { ...newTasks[taskIndex], assignee: newValue };
      }
      break;
      
    case 'change_due_date':
      if (newTasks[taskIndex]) {
        newTasks[taskIndex] = { ...newTasks[taskIndex], due_date: newValue };
      }
      break;
      
    case 'change_workspace':
      // This would require re-matching workspaces
      if (newSuggestions[taskIndex]) {
        // Mark for re-suggestion
        newSuggestions[taskIndex] = { ...newSuggestions[taskIndex], needsUpdate: true };
      }
      break;
  }
  
  return { tasks: newTasks, suggestions: newSuggestions };
}

async function postUpdatedTaskPreview(client, channel, tasks, suggestions, threadTs, editCommands) {
  const editSummary = editCommands.map(cmd => {
    switch (cmd.action) {
      case 'remove':
        return `Removed task ${cmd.taskIndex + 1}`;
      case 'change_assignee':
        return `Changed task ${cmd.taskIndex + 1} assignee to ${cmd.newValue}`;
      case 'change_due_date':
        return `Updated task ${cmd.taskIndex + 1} due date to ${cmd.newValue}`;
      case 'change_workspace':
        return `Changed task ${cmd.taskIndex + 1} workspace to ${cmd.newValue}`;
      default:
        return `Unknown edit: ${cmd.action}`;
    }
  }).join(', ');
  
  const taskBlocks = tasks.map((task, index) => {
    const suggestion = suggestions[index];
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
    thread_ts: threadTs,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `✏️ **Updated Tasks** (${editSummary}):`
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
            value: threadTs
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '✏️ Edit Again' },
            action_id: 'edit_tasks',
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