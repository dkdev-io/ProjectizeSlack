import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

export class MotionService {
  
  constructor() {
    this.apiKey = process.env.MOTION_API_KEY;
    this.workspaceId = process.env.MOTION_WORKSPACE_ID;
    this.baseURL = 'https://api.usemotion.com/v1';
    this.rateLimitDelay = 1000; // 1 second between requests
    this.maxRetries = 3;
    
    // Setup axios instance with defaults
    this.client = axios.create({
      baseURL: this.baseURL,
      headers: {
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json'
      },
      timeout: 30000 // 30 seconds
    });
    
    // Add request interceptor for rate limiting
    this.setupRateLimiting();
  }
  
  setupRateLimiting() {
    let lastRequestTime = 0;
    
    this.client.interceptors.request.use(async (config) => {
      const now = Date.now();
      const timeSinceLastRequest = now - lastRequestTime;
      
      if (timeSinceLastRequest < this.rateLimitDelay) {
        const delay = this.rateLimitDelay - timeSinceLastRequest;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      
      lastRequestTime = Date.now();
      return config;
    });
  }
  
  async createTask(taskData, options = {}) {
    const {
      workspaceId = this.workspaceId,
      projectId = null,
      assigneeId = null
    } = options;
    
    // Transform task data to Motion API format
    const motionTask = {
      name: taskData.title,
      description: taskData.context || '',
      workspaceId: workspaceId,
      projectId: projectId,
      assigneeId: assigneeId,
      priority: this.mapPriority(taskData.priority || 'medium'),
      status: 'TODO'
    };
    
    // Add due date if specified
    if (taskData.due_date) {
      const dueDate = this.parseDueDate(taskData.due_date);
      if (dueDate) {
        motionTask.dueDate = dueDate.toISOString();
      }
    }
    
    try {
      const response = await this.client.post('/tasks', motionTask);
      
      return {
        success: true,
        motionTaskId: response.data.id,
        task: response.data,
        created_at: new Date().toISOString()
      };
      
    } catch (error) {
      return this.handleError('createTask', error, { taskData, options });
    }
  }
  
  async createMultipleTasks(tasks, options = {}) {
    const results = [];
    const batchSize = 10; // Motion API recommended batch size
    
    // Process tasks in batches to respect rate limits
    for (let i = 0; i < tasks.length; i += batchSize) {
      const batch = tasks.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (task, index) => {
        try {
          // Add small delay between concurrent requests in batch
          await new Promise(resolve => setTimeout(resolve, index * 100));
          return await this.createTask(task, options);
        } catch (error) {
          return {
            success: false,
            error: error.message,
            task: task
          };
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      // Delay between batches
      if (i + batchSize < tasks.length) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    
    return {
      success: failed.length === 0,
      total: results.length,
      successful: successful.length,
      failed: failed.length,
      results: results,
      failed_tasks: failed
    };
  }
  
  async getWorkspaces() {
    try {
      const response = await this.client.get('/workspaces');
      
      return {
        success: true,
        workspaces: response.data
      };
      
    } catch (error) {
      return this.handleError('getWorkspaces', error);
    }
  }
  
  async getProjects(workspaceId = this.workspaceId) {
    try {
      const response = await this.client.get(`/workspaces/${workspaceId}/projects`);
      
      return {
        success: true,
        projects: response.data
      };
      
    } catch (error) {
      return this.handleError('getProjects', error, { workspaceId });
    }
  }
  
  async getUsers(workspaceId = this.workspaceId) {
    try {
      const response = await this.client.get(`/workspaces/${workspaceId}/users`);
      
      return {
        success: true,
        users: response.data
      };
      
    } catch (error) {
      return this.handleError('getUsers', error, { workspaceId });
    }
  }
  
  async findUserByEmail(email, workspaceId = this.workspaceId) {
    try {
      const usersResult = await this.getUsers(workspaceId);
      
      if (!usersResult.success) {
        return usersResult;
      }
      
      const user = usersResult.users.find(u => 
        u.email && u.email.toLowerCase() === email.toLowerCase()
      );
      
      return {
        success: !!user,
        user: user || null
      };
      
    } catch (error) {
      return this.handleError('findUserByEmail', error, { email, workspaceId });
    }
  }
  
  async findProjectByName(projectName, workspaceId = this.workspaceId) {
    try {
      const projectsResult = await this.getProjects(workspaceId);
      
      if (!projectsResult.success) {
        return projectsResult;
      }
      
      const project = projectsResult.projects.find(p => 
        p.name && p.name.toLowerCase().includes(projectName.toLowerCase())
      );
      
      return {
        success: !!project,
        project: project || null
      };
      
    } catch (error) {
      return this.handleError('findProjectByName', error, { projectName, workspaceId });
    }
  }
  
  mapPriority(priority) {
    const priorityMap = {
      'high': 'HIGH',
      'medium': 'MEDIUM', 
      'low': 'LOW'
    };
    
    return priorityMap[priority.toLowerCase()] || 'MEDIUM';
  }
  
  parseDueDate(dueDateString) {
    try {
      // Handle common due date formats
      const now = new Date();
      const lowerDue = dueDateString.toLowerCase();
      
      if (lowerDue.includes('today')) {
        return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59);
      }
      
      if (lowerDue.includes('tomorrow')) {
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        return new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 23, 59);
      }
      
      if (lowerDue.includes('monday')) {
        return this.getNextWeekday(1); // Monday = 1
      }
      if (lowerDue.includes('tuesday')) {
        return this.getNextWeekday(2);
      }
      if (lowerDue.includes('wednesday')) {
        return this.getNextWeekday(3);
      }
      if (lowerDue.includes('thursday')) {
        return this.getNextWeekday(4);
      }
      if (lowerDue.includes('friday')) {
        return this.getNextWeekday(5);
      }
      
      // Try to parse as regular date
      const parsed = new Date(dueDateString);
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
      
      return null;
    } catch (error) {
      console.warn('Failed to parse due date:', dueDateString);
      return null;
    }
  }
  
  getNextWeekday(targetDay) {
    const now = new Date();
    const currentDay = now.getDay();
    let daysUntilTarget = targetDay - currentDay;
    
    if (daysUntilTarget <= 0) {
      daysUntilTarget += 7; // Next week
    }
    
    const targetDate = new Date(now);
    targetDate.setDate(targetDate.getDate() + daysUntilTarget);
    targetDate.setHours(23, 59, 0, 0);
    
    return targetDate;
  }
  
  handleError(operation, error, context = {}) {
    const errorInfo = {
      success: false,
      operation,
      error: error.message,
      context,
      timestamp: new Date().toISOString()
    };
    
    if (error.response) {
      errorInfo.status = error.response.status;
      errorInfo.statusText = error.response.statusText;
      errorInfo.data = error.response.data;
      
      // Handle specific Motion API errors
      if (error.response.status === 429) {
        errorInfo.error = 'Rate limit exceeded';
        errorInfo.retryAfter = error.response.headers['retry-after'] || 60;
      } else if (error.response.status === 401) {
        errorInfo.error = 'Invalid API key or authentication failed';
      } else if (error.response.status === 403) {
        errorInfo.error = 'Insufficient permissions';
      } else if (error.response.status === 404) {
        errorInfo.error = 'Resource not found';
      }
    }
    
    console.error(`Motion API ${operation} error:`, errorInfo);
    return errorInfo;
  }
  
  async healthCheck() {
    try {
      const workspacesResult = await this.getWorkspaces();
      
      return {
        healthy: workspacesResult.success,
        api_key_valid: workspacesResult.success,
        workspace_id: this.workspaceId,
        error: workspacesResult.success ? null : workspacesResult.error,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      return {
        healthy: false,
        api_key_valid: false,
        workspace_id: this.workspaceId,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

export default new MotionService();