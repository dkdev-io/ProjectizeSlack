import fs from 'fs/promises';
import path from 'path';

const DATA_DIR = './data';
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');
const MAPPINGS_FILE = path.join(DATA_DIR, 'mappings.json');

export class LocalStorageService {
  
  constructor() {
    this.ensureDataDir();
  }
  
  async ensureDataDir() {
    try {
      await fs.mkdir(DATA_DIR, { recursive: true });
    } catch (error) {
      // Directory already exists
    }
  }
  
  async readFile(filename) {
    try {
      const data = await fs.readFile(filename, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      return [];
    }
  }
  
  async writeFile(filename, data) {
    await fs.writeFile(filename, JSON.stringify(data, null, 2));
  }
  
  // Task queue operations
  async addToTaskQueue(taskData) {
    const tasks = await this.readFile(TASKS_FILE);
    const newTask = {
      id: Date.now().toString(),
      ...taskData,
      created_at: new Date().toISOString(),
      status: 'pending'
    };
    
    tasks.push(newTask);
    await this.writeFile(TASKS_FILE, tasks);
    return newTask;
  }
  
  async updateTaskQueue(id, updates) {
    const tasks = await this.readFile(TASKS_FILE);
    const taskIndex = tasks.findIndex(t => t.id === id);
    
    if (taskIndex === -1) {
      throw new Error(`Task with id ${id} not found`);
    }
    
    tasks[taskIndex] = {
      ...tasks[taskIndex],
      ...updates,
      last_attempt: new Date().toISOString()
    };
    
    await this.writeFile(TASKS_FILE, tasks);
    return tasks[taskIndex];
  }
  
  async getPendingTasks(limit = 10) {
    const tasks = await this.readFile(TASKS_FILE);
    return tasks
      .filter(t => t.status === 'pending' && (t.retry_count || 0) < 3)
      .slice(0, limit);
  }
  
  async getTaskByMessage(messageTs, channelId) {
    const tasks = await this.readFile(TASKS_FILE);
    return tasks.find(t => 
      t.slack_message_ts === messageTs && 
      t.slack_channel_id === channelId
    );
  }
  
  // Channel mapping operations
  async getChannelMapping(channelId, workspaceId) {
    const mappings = await this.readFile(MAPPINGS_FILE);
    return mappings.find(m => 
      m.slack_channel_id === channelId && 
      m.slack_workspace_id === workspaceId
    );
  }
  
  async createChannelMapping(mappingData) {
    const mappings = await this.readFile(MAPPINGS_FILE);
    const newMapping = {
      id: Date.now().toString(),
      ...mappingData,
      created_at: new Date().toISOString()
    };
    
    mappings.push(newMapping);
    await this.writeFile(MAPPINGS_FILE, mappings);
    return newMapping;
  }
  
  // Task history operations
  async addTaskHistory(historyData) {
    // For local testing, just log to console
    console.log('📋 Task History:', {
      channel: historyData.slack_channel_id,
      tasks: historyData.extracted_tasks?.length || 0,
      success: historyData.success,
      timestamp: new Date().toISOString()
    });
    return { id: Date.now().toString(), ...historyData };
  }
  
  // User linkage operations (simplified for testing)
  async getUserLinkage(slackUserId, workspaceId) {
    // For testing, return null (no user linkages)
    return null;
  }
  
  async createUserLinkage(linkageData) {
    console.log('🔗 User linkage created (local testing):', linkageData);
    return { id: Date.now().toString(), ...linkageData };
  }
  
  // Health check
  async healthCheck() {
    try {
      await this.ensureDataDir();
      return {
        healthy: true,
        storage: 'local',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        healthy: false,
        storage: 'local',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
  
  // Debug: Show all stored data
  async showDebugInfo() {
    const tasks = await this.readFile(TASKS_FILE);
    const mappings = await this.readFile(MAPPINGS_FILE);
    
    console.log('📊 Local Storage Debug:');
    console.log(`  Tasks: ${tasks.length}`);
    console.log(`  Channel Mappings: ${mappings.length}`);
    
    if (tasks.length > 0) {
      console.log('  Recent Tasks:');
      tasks.slice(-3).forEach(task => {
        console.log(`    ${task.id}: ${task.extracted_tasks?.length || 0} tasks, status: ${task.status}`);
      });
    }
    
    return { tasks, mappings };
  }
}

export default new LocalStorageService();