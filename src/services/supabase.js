import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export class SupabaseService {
  
  // User linkage operations
  async getUserLinkage(slackUserId, workspaceId) {
    const { data, error } = await supabase
      .from('user_linkages')
      .select('*')
      .eq('slack_user_id', slackUserId)
      .eq('slack_workspace_id', workspaceId)
      .single();
      
    if (error && error.code !== 'PGRST116') { // Not found is OK
      throw new Error(`Failed to get user linkage: ${error.message}`);
    }
    
    return data;
  }
  
  async createUserLinkage(linkageData) {
    const { data, error } = await supabase
      .from('user_linkages')
      .insert([linkageData])
      .select()
      .single();
      
    if (error) {
      throw new Error(`Failed to create user linkage: ${error.message}`);
    }
    
    return data;
  }
  
  async updateUserLinkage(slackUserId, workspaceId, updates) {
    const { data, error } = await supabase
      .from('user_linkages')
      .update({
        ...updates,
        last_used: new Date().toISOString()
      })
      .eq('slack_user_id', slackUserId)
      .eq('slack_workspace_id', workspaceId)
      .select()
      .single();
      
    if (error) {
      throw new Error(`Failed to update user linkage: ${error.message}`);
    }
    
    return data;
  }
  
  // Channel mapping operations
  async getChannelMapping(channelId, workspaceId) {
    const { data, error } = await supabase
      .from('channel_mappings')
      .select('*')
      .eq('slack_channel_id', channelId)
      .eq('slack_workspace_id', workspaceId)
      .single();
      
    if (error && error.code !== 'PGRST116') {
      throw new Error(`Failed to get channel mapping: ${error.message}`);
    }
    
    return data;
  }
  
  async createChannelMapping(mappingData) {
    const { data, error } = await supabase
      .from('channel_mappings')
      .insert([mappingData])
      .select()
      .single();
      
    if (error) {
      throw new Error(`Failed to create channel mapping: ${error.message}`);
    }
    
    return data;
  }
  
  async updateChannelMapping(channelId, workspaceId, updates) {
    const { data, error } = await supabase
      .from('channel_mappings')
      .update(updates)
      .eq('slack_channel_id', channelId)
      .eq('slack_workspace_id', workspaceId)
      .select()
      .single();
      
    if (error) {
      throw new Error(`Failed to update channel mapping: ${error.message}`);
    }
    
    return data;
  }
  
  // Task queue operations
  async addToTaskQueue(taskData) {
    const { data, error } = await supabase
      .from('task_queue')
      .insert([taskData])
      .select()
      .single();
      
    if (error) {
      throw new Error(`Failed to add to task queue: ${error.message}`);
    }
    
    return data;
  }
  
  async updateTaskQueue(id, updates) {
    const { data, error } = await supabase
      .from('task_queue')
      .update({
        ...updates,
        last_attempt: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();
      
    if (error) {
      throw new Error(`Failed to update task queue: ${error.message}`);
    }
    
    return data;
  }
  
  async getPendingTasks(limit = 10) {
    const { data, error } = await supabase
      .from('task_queue')
      .select('*')
      .eq('status', 'pending')
      .lt('retry_count', 3)
      .order('created_at', { ascending: true })
      .limit(limit);
      
    if (error) {
      throw new Error(`Failed to get pending tasks: ${error.message}`);
    }
    
    return data || [];
  }
  
  // Task history operations
  async addTaskHistory(historyData) {
    const { data, error } = await supabase
      .from('task_history')
      .insert([historyData])
      .select()
      .single();
      
    if (error) {
      throw new Error(`Failed to add task history: ${error.message}`);
    }
    
    return data;
  }
  
  async getTaskHistory(channelId, limit = 50) {
    const { data, error } = await supabase
      .from('task_history')
      .select('*')
      .eq('slack_channel_id', channelId)
      .order('created_at', { ascending: false })
      .limit(limit);
      
    if (error) {
      throw new Error(`Failed to get task history: ${error.message}`);
    }
    
    return data || [];
  }
  
  // Health check
  async healthCheck() {
    try {
      const { data, error } = await supabase
        .from('user_linkages')
        .select('count')
        .limit(1);
        
      if (error) {
        throw error;
      }
      
      return { healthy: true, timestamp: new Date().toISOString() };
    } catch (error) {
      return { 
        healthy: false, 
        error: error.message,
        timestamp: new Date().toISOString() 
      };
    }
  }
}

export default new SupabaseService();