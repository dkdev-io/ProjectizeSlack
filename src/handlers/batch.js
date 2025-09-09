import motionService from '../services/motion.js';
import supabaseService from '../services/supabase.js';

export async function handleBatch({ action, messageTs, channelId, userId, client, logger }) {
  try {
    // Get the queued tasks for this message
    const { data: queuedTasks, error } = await supabaseService.supabase
      .from('task_queue')
      .select('*')
      .eq('slack_message_ts', messageTs)
      .eq('slack_channel_id', channelId)
      .eq('status', 'pending')
      .single();
    
    if (error || !queuedTasks) {
      await client.chat.postMessage({
        channel: channelId,
        text: `❌ Could not find tasks to ${action}. They may have already been processed.`,
        thread_ts: messageTs
      });
      return;
    }
    
    if (action === 'reject') {
      await handleTaskRejection(queuedTasks, client, channelId, messageTs);
      return;
    }
    
    if (action === 'approve') {
      await handleTaskApproval(queuedTasks, client, channelId, messageTs, userId);
      return;
    }
    
  } catch (error) {
    logger.error('Error in handleBatch:', error);
    await client.chat.postMessage({
      channel: channelId,
      text: `❌ Error processing tasks.`,
      thread_ts: messageTs
    });
  }
}

async function handleTaskRejection(queuedTasks, client, channelId, messageTs) {
  try {
    // Mark tasks as failed/rejected
    await supabaseService.updateTaskQueue(queuedTasks.id, {
      status: 'failed',
      error_message: 'Rejected by user'
    });
    
    await client.chat.postMessage({
      channel: channelId,
      text: `❌ Tasks cancelled.`,
      thread_ts: messageTs
    });
    
  } catch (error) {
    console.error('Task rejection error:', error);
  }
}

async function handleTaskApproval(queuedTasks, client, channelId, messageTs, userId) {
  try {
    // Mark as processing
    await supabaseService.updateTaskQueue(queuedTasks.id, {
      status: 'processing'
    });
    
    // Post "creating tasks" message
    const processingMsg = await client.chat.postMessage({
      channel: channelId,
      text: `🔄 Creating ${queuedTasks.extracted_tasks.length} task${queuedTasks.extracted_tasks.length > 1 ? 's' : ''} in Motion...`,
      thread_ts: messageTs
    });
    
    // Get channel mapping for Motion project info
    const channelMapping = await supabaseService.getChannelMapping(channelId, 'workspace'); // TODO: get actual workspace ID
    
    // Get user linkage for Motion integration (if implementing user-specific tokens)
    // For now, use admin API key from environment
    
    const motionOptions = {
      workspaceId: process.env.MOTION_WORKSPACE_ID,
      projectId: channelMapping?.motion_project_id || null
    };
    
    // Create tasks in Motion
    const motionResult = await motionService.createMultipleTasks(
      queuedTasks.extracted_tasks,
      motionOptions
    );
    
    if (motionResult.success) {
      // Update task queue as completed
      await supabaseService.updateTaskQueue(queuedTasks.id, {
        status: 'completed'
      });
      
      // Store in history
      const motionTaskIds = motionResult.results
        .filter(r => r.success)
        .map(r => r.motionTaskId);
        
      await supabaseService.addTaskHistory({
        slack_message_ts: messageTs,
        slack_channel_id: channelId,
        original_message: JSON.stringify(queuedTasks.extracted_tasks),
        extracted_tasks: queuedTasks.extracted_tasks,
        motion_task_ids: motionTaskIds,
        success: true
      });
      
      // Update success message
      await client.chat.update({
        channel: channelId,
        ts: processingMsg.ts,
        text: `✅ Successfully created ${motionResult.successful} task${motionResult.successful > 1 ? 's' : ''} in Motion!${motionResult.failed > 0 ? `\n⚠️ ${motionResult.failed} task${motionResult.failed > 1 ? 's' : ''} failed to sync.` : ''}`,
      });
      
      // Post failure details if any
      if (motionResult.failed > 0) {
        const failedTasks = motionResult.failed_tasks
          .map(ft => `• ${ft.task.title}: ${ft.error}`)
          .join('\n');
          
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: messageTs,
          text: `❌ Failed tasks:\n${failedTasks}`
        });
      }
      
    } else {
      // Motion sync failed completely
      await supabaseService.updateTaskQueue(queuedTasks.id, {
        status: 'failed',
        error_message: 'Motion API error',
        retry_count: (queuedTasks.retry_count || 0) + 1
      });
      
      await client.chat.update({
        channel: channelId,
        ts: processingMsg.ts,
        text: `⚠️ Failed to sync tasks to Motion. They've been queued for retry.`
      });
    }
    
  } catch (error) {
    console.error('Task approval error:', error);
    
    // Mark as failed and increment retry count
    await supabaseService.updateTaskQueue(queuedTasks.id, {
      status: 'failed',
      error_message: error.message,
      retry_count: (queuedTasks.retry_count || 0) + 1
    });
    
    await client.chat.postMessage({
      channel: channelId,
      text: `❌ Error creating tasks: ${error.message}`,
      thread_ts: messageTs
    });
  }
}

// Background retry processor
export async function processRetryQueue() {
  try {
    const pendingTasks = await supabaseService.getPendingTasks(5); // Process 5 at a time
    
    for (const task of pendingTasks) {
      if (task.retry_count >= 3) {
        // Mark as permanently failed after 3 retries
        await supabaseService.updateTaskQueue(task.id, {
          status: 'failed',
          error_message: 'Max retries exceeded'
        });
        continue;
      }
      
      try {
        // Retry Motion sync
        const motionResult = await motionService.createMultipleTasks(task.extracted_tasks);
        
        if (motionResult.success) {
          await supabaseService.updateTaskQueue(task.id, {
            status: 'completed'
          });
          console.log(`✅ Retry successful for task ${task.id}`);
        } else {
          await supabaseService.updateTaskQueue(task.id, {
            status: 'pending', // Keep pending for next retry
            retry_count: task.retry_count + 1,
            error_message: 'Motion sync failed'
          });
        }
        
      } catch (error) {
        await supabaseService.updateTaskQueue(task.id, {
          status: 'pending',
          retry_count: task.retry_count + 1,
          error_message: error.message
        });
      }
      
      // Rate limit between retries
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
  } catch (error) {
    console.error('Retry queue processing error:', error);
  }
}

// Start retry processor (call this in main app)
export function startRetryProcessor() {
  setInterval(processRetryQueue, 5 * 60 * 1000); // Every 5 minutes
  console.log('📋 Task retry processor started');
}